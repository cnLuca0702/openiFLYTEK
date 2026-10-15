import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { notebookStore } from './notebook_store.js';
import { getNotebookResourceDir, getRelativeNotebookPath, getSafeResourcePath } from './storage_paths.js';
import { parseDetailContent, parseRecordTranscript } from './record_parser.js';

function asMessage(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

function stageError(stage, message, code = 'NOTEBOOK_DOWNLOAD_FAILED') {
  const error = new Error(message);
  error.stage = stage;
  error.code = code;
  return error;
}

function normalizeUrls(value) {
  const urls = Array.isArray(value) ? value : [value];
  return urls.filter((url) => typeof url === 'string' && url.length > 0).map((url) => {
    try {
      const parsed = new URL(url);
      // 生产 OSS 地址沿用官方客户端的 http→https 升级；仅测试/本机服务允许保留 HTTP。
      if (parsed.protocol === 'http:' && !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
        parsed.protocol = 'https:';
      }
      return parsed.toString();
    } catch (_) {
      return url;
    }
  });
}

async function writeResponseToFile(response, destination) {
  if (!response.ok || !response.body) {
    throw stageError('download_part', `下载附件失败：HTTP ${response.status}`, `HTTP_${response.status}`);
  }
  const temp = `${destination}.down`;
  fs.rmSync(temp, { force: true });
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temp));
  fs.renameSync(temp, destination);
}

function assertOggOpus(filePath) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const header = Buffer.alloc(4);
    const bytes = fs.readSync(fd, header, 0, 4, 0);
    if (bytes !== 4 || header.toString('latin1') !== 'OggS') {
      throw stageError('validate', '录音缓存校验失败：文件不是 Ogg Opus', 'INVALID_AUDIO_FORMAT');
    }
  } finally {
    fs.closeSync(fd);
  }
}

export class NotebookIntegrationService {
  constructor(client) {
    this.client = client;
    this.inflightDownloads = new Map();
  }

  getUserId() {
    const userId = this.client.getTokenInfo()?.userInfo?.userId;
    if (!userId) {
      const error = new Error('当前账号缺少 userId，请重新登录讯飞办公本');
      error.code = 401;
      throw error;
    }
    return String(userId);
  }

  async refreshNoteDetail(noteId) {
    const raw = await this.client.getNoteDetailRaw(noteId);
    const parsed = parseDetailContent(raw);
    if (!parsed.noteId) parsed.noteId = String(noteId);
    if (!parsed.userId) parsed.userId = this.getUserId();
    notebookStore.upsertCloudNote(parsed);
    return parsed;
  }

  async getDetail(noteId, { refresh = true } = {}) {
    let detail = null;
    if (refresh) detail = await this.refreshNoteDetail(noteId);
    const note = notebookStore.getCloudNote(noteId);
    if (!note && !detail) throw new Error('未找到该云笔记');
    const sentences = notebookStore.getCloudSentences(noteId).map((s, index) => ({
      id: `${noteId}_${index}`,
      speaker: s.speaker,
      time: `${String(Math.floor(Number(s.begin_ms) / 60000)).padStart(2, '0')}:${String(Math.floor(Number(s.begin_ms) / 1000) % 60).padStart(2, '0')}`,
      startTimeMs: Number(s.begin_ms),
      endTimeMs: Number(s.end_ms),
      text: s.text,
      trans: '',
    }));
    const audioReady = Boolean(note?.audio_object_name && note?.download_state === 'ready' && this.getAudioPath(noteId));
    return {
      noteId,
      title: note?.note_name || detail?.title || '办公本笔记',
      type: Number(note?.type || detail?.type || 0),
      content: note?.detail?.content || detail?.rawDetail?.content || '',
      contentJson: detail?.content || null,
      audioPath: note?.audio_object_name || detail?.audioObjectName || '',
      audioDuration: Number(note?.audio_duration_ms || detail?.durationMs || 0),
      hasAudio: Boolean(note?.audio_object_name || detail?.audioObjectName),
      transcriptPath: note?.transcript_object_name || detail?.transcriptObjectName || '',
      audio: {
        state: audioReady ? 'ready' : (note?.download_state || 'not_downloaded'),
        objectName: note?.audio_object_name || detail?.audioObjectName || '',
        localUrl: `/api/notebook/notes/${encodeURIComponent(noteId)}/audio`,
      },
      sentences,
    };
  }

  getAudioPath(noteId) {
    const note = notebookStore.getCloudNote(noteId);
    if (!note?.audio_object_name || !note?.user_id) return null;
    const target = getSafeResourcePath(note.user_id, noteId, note.audio_object_name);
    return fs.existsSync(target) && fs.statSync(target).size > 4 ? target : null;
  }

  async getSignedUrls({ userId, dir, objectName, increment }) {
    const data = await this.client.getDownloadUrl({ userId, dir, objectName, expiration: 86400, increment });
    if (data?.code !== true) {
      throw stageError('get_url', data?.message || `云端未返回 ${objectName} 的可下载地址`, 'DOWNLOAD_URL_REJECTED');
    }
    const urls = normalizeUrls(data?.url || data?.downloadUrl);
    if (!urls.length) throw stageError('get_url', `云端未返回 ${objectName} 的下载地址`, 'DOWNLOAD_URL_EMPTY');
    return urls;
  }

  async downloadObject({ userId, noteId, dir, objectName, increment, destination, validateAudio = false }) {
    const urls = await this.getSignedUrls({ userId, dir, objectName, increment });
    const resourceDir = path.dirname(destination);
    fs.mkdirSync(resourceDir, { recursive: true });
    const partPaths = [];
    try {
      for (let index = 0; index < urls.length; index += 1) {
        const part = urls.length === 1 ? `${destination}.part` : path.join(resourceDir, `part_${path.basename(destination)}_${index}`);
        fs.rmSync(part, { force: true });
        const response = await fetch(urls[index]);
        await writeResponseToFile(response, part);
        partPaths.push(part);
      }
      const staged = `${destination}.merge`;
      fs.rmSync(staged, { force: true });
      const writer = fs.createWriteStream(staged);
      for (const part of partPaths) {
        await pipeline(fs.createReadStream(part), writer, { end: false });
      }
      await new Promise((resolve, reject) => {
        writer.once('error', reject);
        writer.end(resolve);
      });
      if (validateAudio) assertOggOpus(staged);
      fs.renameSync(staged, destination);
      fs.writeFileSync(`${destination}.parts.json`, JSON.stringify({
        partCount: urls.length,
        objectName,
        completedAt: new Date().toISOString(),
        sizes: partPaths.map((part) => fs.statSync(part).size),
      }, null, 2));
      partPaths.forEach((part) => fs.rmSync(part, { force: true }));
      return destination;
    } catch (error) {
      fs.rmSync(`${destination}.merge`, { force: true });
      partPaths.forEach((part) => fs.rmSync(part, { force: true }));
      throw error;
    }
  }

  async downloadNote(noteId, { force = false, includeTranscript = true } = {}) {
    if (this.inflightDownloads.has(noteId)) return this.inflightDownloads.get(noteId);
    const operation = this._downloadNote(noteId, { force, includeTranscript });
    this.inflightDownloads.set(noteId, operation);
    try {
      return await operation;
    } finally {
      this.inflightDownloads.delete(noteId);
    }
  }

  async _downloadNote(noteId, { force, includeTranscript }) {
    const detail = await this.refreshNoteDetail(noteId);
    const userId = detail.userId || this.getUserId();
    notebookStore.setDownloadState(noteId, 'downloading');
    try {
      let audioRelativePath = null;
      if (detail.audioObjectName) {
        const destination = getSafeResourcePath(userId, noteId, detail.audioObjectName);
        if (force) {
          fs.rmSync(destination, { force: true });
          fs.rmSync(`${destination}.parts.json`, { force: true });
        }
        if (!fs.existsSync(destination) || fs.statSync(destination).size < 5) {
          await this.downloadObject({
            userId,
            noteId,
            dir: 'shorthand',
            objectName: detail.audioObjectName,
            increment: 1,
            destination,
            validateAudio: true,
          });
        } else {
          assertOggOpus(destination);
        }
        audioRelativePath = getRelativeNotebookPath(destination);
      }

      if (includeTranscript && detail.transcriptObjectName) {
        const transcriptPath = getSafeResourcePath(userId, noteId, detail.transcriptObjectName.replace(/\.txt$/i, '.json'));
        if (force || !fs.existsSync(transcriptPath)) {
          await this.downloadObject({
            userId,
            noteId,
            dir: 'attachment',
            objectName: detail.transcriptObjectName,
            increment: 0,
            destination: transcriptPath,
          });
        }
        let transcript;
        try {
          transcript = JSON.parse(fs.readFileSync(transcriptPath, 'utf-8'));
        } catch (_) {
          throw stageError('transcript', '云端转写附件不是有效 JSON', 'INVALID_TRANSCRIPT');
        }
        notebookStore.replaceCloudSentences(noteId, parseRecordTranscript(transcript, noteId));
      }

      notebookStore.setDownloadState(noteId, 'ready', { downloadedAt: Date.now() });
      return { noteId, state: 'ready', audioRelativePath, sentenceCount: notebookStore.getCloudSentences(noteId).length };
    } catch (error) {
      const stage = error?.stage || 'download_part';
      notebookStore.setDownloadState(noteId, 'failed', { errorCode: error?.code || 'NOTEBOOK_DOWNLOAD_FAILED', errorMessage: asMessage(error), errorStage: stage });
      throw error;
    }
  }

  async importNote(noteId) {
    const detail = await this.refreshNoteDetail(noteId);
    const current = notebookStore.getCloudNote(noteId);
    if (detail.hasAudio && current?.download_state !== 'ready') {
      const error = new Error('录音尚未下载完成，请先完成下载后再导入');
      error.code = 'AUDIO_NOT_READY';
      throw error;
    }
    const audioPath = this.getAudioPath(noteId);
    if (detail.hasAudio && !audioPath) {
      const error = new Error('录音缓存不存在，请重新下载');
      error.code = 'AUDIO_NOT_READY';
      throw error;
    }
    return notebookStore.importNotebookMeeting(noteId, audioPath ? getRelativeNotebookPath(audioPath) : null);
  }
}
