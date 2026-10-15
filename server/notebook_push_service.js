// 推送到智能办公本的编排服务
//   fileport：读写驿站 ← 会议纪要全文 DOCX（办公本不支持 .md）
//   record  ：办公本笔记 ← 录音笔记（Ogg Opus 录音 + 文字面板 = 纪要全文 + 带时间戳逐句转写）
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { renderDocx } from './docx_writer.js';
import { buildMinutes, minutesToDocxBlocks, minutesToTranscriptEntries, minutesPreview } from './minutes_document.js';

const execFileAsync = promisify(execFile);
const FFMPEG_CANDIDATES = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];

const safeFileName = (s) => String(s || '会议纪要').replace(/[\/\\?%*:|"<>\u0000-\u001f]/g, '_').trim().slice(0, 80) || '会议纪要';

async function findFfmpeg() {
  for (const bin of FFMPEG_CANDIDATES) {
    try { await execFileAsync(bin, ['-hide_banner', '-version'], { timeout: 10_000 }); return bin; } catch (_) {}
  }
  throw Object.assign(new Error('未找到 ffmpeg，无法把录音转成办公本支持的 Ogg Opus。请先安装：brew install ffmpeg'), { code: 500, stage: 'ffmpeg' });
}

/** 转码为办公本原生格式：Ogg Opus / 48kHz / 单声道（与办公本自录音频一致） */
async function convertToOggOpus(srcPath) {
  const ffmpeg = await findFfmpeg();
  const out = path.join(os.tmpdir(), `viaim-push-${crypto.randomUUID()}.opus`);
  await execFileAsync(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', srcPath, '-vn', '-ac', '1', '-ar', '48000', '-c:a', 'libopus', '-b:a', '32k', '-application', 'voip', '-f', 'ogg', out], { timeout: 30 * 60_000, maxBuffer: 8 * 1024 * 1024 });
  const buf = fs.readFileSync(out);
  fs.unlinkSync(out);
  if (buf.subarray(0, 4).toString('latin1') !== 'OggS') throw Object.assign(new Error('转码结果不是 Ogg Opus'), { code: 500, stage: 'ffmpeg' });
  return buf;
}

export class NotebookPushService {
  constructor({ client, store, exportDir, resolveAudioPath }) {
    this.client = client;
    this.store = store;
    this.exportDir = exportDir;
    this.resolveAudioPath = resolveAudioPath;
  }

  /** 读写驿站：推送纪要全文 DOCX */
  async pushMinutesToFilePort(meeting) {
    const minutes = buildMinutes(meeting);
    const buffer = renderDocx(minutesToDocxBlocks(minutes), { title: minutes.title });
    fs.mkdirSync(this.exportDir, { recursive: true });
    const fileName = `${safeFileName(minutes.title)}.docx`;
    const filePath = path.join(this.exportDir, fileName);
    fs.writeFileSync(filePath, buffer);
    const result = await this.client.pushFilePort(filePath, fileName);
    return { target: 'fileport', ok: true, fileName, localFile: filePath, size: buffer.length, filePortId: result.filePortId };
  }

  /** 办公本笔记：创建/更新录音笔记（音频 + 纪要全文文字） */
  async pushRecordNote(meeting) {
    const audioPath = this.resolveAudioPath(meeting.id);
    if (!audioPath || !fs.existsSync(audioPath)) {
      throw Object.assign(new Error('该会议没有可用的本地录音，无法生成办公本录音笔记'), { code: 404, stage: 'audio' });
    }
    const minutes = buildMinutes(meeting);
    const audio = await convertToOggOpus(audioPath);
    const target = await this.client.resolveRecordTarget();
    const userInfo = this.client.getTokenInfo()?.userInfo || {};

    // 同一会议重复推送：沿用同一个 noteId（官方 uploadRecordFile 以 noteSN 为键，再次上传即更新）
    const prev = this.store.getPushedRecordNote(meeting.id);
    const noteId = prev?.note_id || crypto.randomUUID().replace(/-/g, '');
    const createTime = prev?.create_time || (meeting.createdAt ? new Date(meeting.createdAt).getTime() : Date.now());
    const updateTime = Date.now();

    const entries = minutesToTranscriptEntries(minutes);
    const transcriptBuf = Buffer.from(JSON.stringify(entries), 'utf8');
    const snPrefix = (target.sn || 'viaim').toLowerCase();
    const audioObjectName = `${snPrefix}${noteId}.opus`;
    const transcriptObjectName = `${createTime}_${crypto.createHash('md5').update(transcriptBuf).digest('hex')}.txt`;

    await this.client.uploadObject('shorthand', audioObjectName, audio);
    await this.client.uploadObject('attachment', transcriptObjectName, transcriptBuf);

    const durationMs = Number(meeting.durationMs) || Math.max(0, ...minutes.sentences.map((s) => s.endMs));
    const preview = minutesPreview(minutes);
    const contentJson = {
      address: '',
      insertPicVersion: 1,
      record: { pageList: [] },
      transferModels: [],
      noteInfo: {
        isReName: true,
        bgMode: 0,
        isTempDeleted: false,
        needReadPassword: false,
        precision: 'millisecond',
        recordCount: 0,
        stateBackup: 'FLAG_NORMAL',
        downloadProgress: 0,
        type: 2,
        shareType: 0,
        local: false,
        duration: durationMs,
        offline: false,
        isNimbleStar: false,
        intro: preview,
        isDownloadFaiure: false,
        isNotebook: false,
        recordShareModules: 0,
        state: 'FLAG_MODIFIED',
        openTime: updateTime,
        lastTransferOffset: 0,
        opusSize: audio.length,
        syncFlag: 0,
        totalPage: 0,
        dinTime: 0,
        noteCount: 0,
        userName: userInfo.userName || '',
        sync: 'FLAG_NORMAL',
        userId: userInfo.userId || '',
        operationTime: updateTime,
        needCode: false,
        curPage: 0,
        createTime,
        name: minutes.title,
        folderServerId: target.dir,
        lastModified: updateTime,
        _isNewNotebook: false,
        validDays: 7,
      },
      audio: {
        offline: false,
        accuracy: 'millisecond',
        marks: [],
        audioDuration: String(durationMs),
        audioPath: audioObjectName,
      },
      text: { onlineTransferTextPath: transcriptObjectName },
      version: 7,
      modules: JSON.stringify(['audio', 'trans']),
      syntime: 0,
      reqId: '',
    };

    const data = await this.client.uploadRecordNote({
      noteId,
      noteName: minutes.title,
      contentJson,
      createTime,
      updateTime,
      summary: preview,
      wavTime: durationMs,
      dir: target.dir,
      dirName: target.dirName,
      sn: target.sn,
      version: target.version,
    });

    const result = { target: 'record', ok: true, noteId, updated: !!prev, durationMs, audioBytes: audio.length, textEntries: entries.length, dirName: target.dirName, syntime: data?.syntime };
    this.store.savePushedRecordNote({ meetingId: meeting.id, noteId, createTime, audioObjectName, transcriptObjectName, result });
    return result;
  }
}
