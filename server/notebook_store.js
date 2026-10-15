import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  NOTEBOOK_DB_PATH,
  NOTEBOOK_RECORDING_DIR,
  ensureNotebookStorage,
  getRelativeNotebookPath,
  resolveNotebookPath,
} from './storage_paths.js';
import { formatDuration, formatTime } from './record_parser.js';

let db = null;

function now() {
  return Date.now();
}

function getDb() {
  if (db) return db;
  ensureNotebookStorage();
  db = new DatabaseSync(NOTEBOOK_DB_PATH);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS cloud_note (
      note_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type INTEGER NOT NULL,
      note_name TEXT,
      dir_id TEXT,
      dir_name TEXT,
      is_encrypt INTEGER NOT NULL DEFAULT 0,
      remote_create_time INTEGER,
      remote_sync_time INTEGER,
      remote_version TEXT,
      audio_object_name TEXT,
      audio_duration_ms INTEGER NOT NULL DEFAULT 0,
      transcript_object_name TEXT,
      detail_json TEXT,
      downloaded_at INTEGER,
      download_state TEXT NOT NULL DEFAULT 'not_downloaded',
      download_error_code TEXT,
      download_error_message TEXT,
      download_error_stage TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cloud_sentence (
      note_id TEXT NOT NULL REFERENCES cloud_note(note_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      segment INTEGER,
      speaker TEXT,
      begin_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      PRIMARY KEY(note_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS project_meeting (
      meeting_id TEXT PRIMARY KEY,
      source TEXT NOT NULL CHECK(source IN ('notebook', 'recording')),
      cloud_note_id TEXT UNIQUE REFERENCES cloud_note(note_id),
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      audio_relative_path TEXT,
      audio_source TEXT,
      has_audio INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS project_sentence (
      meeting_id TEXT NOT NULL REFERENCES project_meeting(meeting_id) ON DELETE CASCADE,
      ordinal INTEGER NOT NULL,
      speaker TEXT,
      start_ms INTEGER NOT NULL,
      end_ms INTEGER NOT NULL,
      text TEXT NOT NULL,
      trans TEXT,
      PRIMARY KEY(meeting_id, ordinal)
    );
    CREATE TABLE IF NOT EXISTS project_todo (
      todo_id TEXT PRIMARY KEY,
      meeting_id TEXT NOT NULL REFERENCES project_meeting(meeting_id) ON DELETE CASCADE,
      task TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      ordinal INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS meeting_summary (
      meeting_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS legacy_replacement (
      legacy_meeting_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL UNIQUE REFERENCES cloud_note(note_id),
      replacement_meeting_id TEXT NOT NULL REFERENCES project_meeting(meeting_id),
      verification_json TEXT NOT NULL,
      backed_up_at INTEGER NOT NULL,
      legacy_soft_deleted_at INTEGER,
      status TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_cloud_note_user_synctime ON cloud_note(user_id, remote_sync_time DESC);
    CREATE INDEX IF NOT EXISTS idx_sentence_note_time ON cloud_sentence(note_id, begin_ms);
    CREATE INDEX IF NOT EXISTS idx_project_meeting_created ON project_meeting(deleted_at, created_at DESC);
    CREATE TABLE IF NOT EXISTS pushed_record_note (
      meeting_id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL,
      create_time INTEGER NOT NULL,
      audio_object_name TEXT,
      transcript_object_name TEXT,
      last_pushed_at INTEGER,
      last_result TEXT
    );
  `);
  return db;
}

function asJson(value) {
  try { return JSON.stringify(value ?? null); } catch (_) { return null; }
}

function parseJson(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch (_) { return fallback; }
}

function getStoredSummary(meetingId) {
  const row = getDb().prepare(`SELECT payload_json FROM meeting_summary WHERE meeting_id = ?`).get(meetingId);
  return row ? parseJson(row.payload_json, null) : null;
}

function toMeeting(row, sentences = [], todos = []) {
  const storedSummary = getStoredSummary(row.meeting_id);
  const hasAudio = Number(row.has_audio) === 1;
  const relativePath = row.audio_relative_path || null;
  const audioUrl = row.source === 'notebook' && row.cloud_note_id
    ? `/api/notebook/notes/${encodeURIComponent(row.cloud_note_id)}/audio`
    : relativePath ? `/api/meetings/${encodeURIComponent(row.meeting_id)}/audio` : null;
  return {
    id: row.meeting_id,
    source: row.source,
    cloudNoteId: row.cloud_note_id || undefined,
    title: row.title,
    subtitle: row.source === 'notebook' ? '讯飞智能办公本云笔记' : 'VIAIM Studio 本地录音',
    createdAt: new Date(Number(row.created_at)).toISOString(),
    duration: formatDuration(row.duration_ms),
    durationMs: Number(row.duration_ms) || 0,
    category: row.source === 'notebook' ? '办公本云笔记' : '本地录音',
    audioSource: row.audio_source || (row.source === 'notebook' ? '讯飞办公本缓存录音（Ogg Opus）' : 'VIAIM Studio 本地录音'),
    status: 'completed',
    speakerCount: new Set(sentences.map((s) => s.speaker).filter(Boolean)).size || 1,
    hasAudio,
    audioUrl,
    audioState: relativePath && fs.existsSync(resolveNotebookPath(relativePath)) ? 'ready' : (hasAudio ? 'not_downloaded' : 'none'),
    sentenceCount: sentences.length,
    todoCount: todos.length,
    hasSummary: !!storedSummary,
    sentences: sentences.map((s, index) => ({
      id: `${row.meeting_id}_${index}`,
      speaker: s.speaker || '说话人 1',
      time: formatTime(s.start_ms),
      startTimeMs: Number(s.start_ms),
      endTimeMs: Number(s.end_ms),
      text: s.text,
      trans: s.trans || '',
    })),
    aiSummary: storedSummary || {
      generated: false,
      title: row.title,
      abstract: '',
      summaryFull: '',
      topics: [],
      todos: todos.map((t) => ({ id: t.todo_id, task: t.task, done: Number(t.done) === 1, owner: '参会人' })),
    },
  };
}

function getSentences(meetingId) {
  return getDb().prepare(`SELECT ordinal, speaker, start_ms, end_ms, text, trans FROM project_sentence WHERE meeting_id = ? ORDER BY ordinal`).all(meetingId);
}

function getTodos(meetingId) {
  return getDb().prepare(`SELECT todo_id, task, done, ordinal FROM project_todo WHERE meeting_id = ? ORDER BY ordinal`).all(meetingId);
}

export const notebookStore = {
  initialize() {
    getDb();
  },

  // 会议 → 推送到办公本的录音笔记映射（重复推送沿用同一 noteId，即云端更新）
  getPushedRecordNote(meetingId) {
    return getDb().prepare('SELECT * FROM pushed_record_note WHERE meeting_id = ?').get(meetingId) || null;
  },

  savePushedRecordNote({ meetingId, noteId, createTime, audioObjectName, transcriptObjectName, result }) {
    getDb().prepare(`
      INSERT INTO pushed_record_note (meeting_id, note_id, create_time, audio_object_name, transcript_object_name, last_pushed_at, last_result)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meeting_id) DO UPDATE SET note_id=excluded.note_id, audio_object_name=excluded.audio_object_name,
        transcript_object_name=excluded.transcript_object_name, last_pushed_at=excluded.last_pushed_at, last_result=excluded.last_result
    `).run(meetingId, noteId, createTime, audioObjectName || '', transcriptObjectName || '', now(), asJson(result || {}));
    return this.getPushedRecordNote(meetingId);
  },

  deletePushedRecordNote(meetingId) {
    getDb().prepare('DELETE FROM pushed_record_note WHERE meeting_id = ?').run(meetingId);
  },

  upsertCloudNote(detail) {
    const database = getDb();
    const timestamp = now();
    database.prepare(`
      INSERT INTO cloud_note (
        note_id, user_id, type, note_name, dir_id, dir_name, is_encrypt,
        remote_create_time, remote_sync_time, remote_version, audio_object_name,
        audio_duration_ms, transcript_object_name, detail_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(note_id) DO UPDATE SET
        user_id=excluded.user_id, type=excluded.type, note_name=excluded.note_name,
        dir_id=excluded.dir_id, dir_name=excluded.dir_name, is_encrypt=excluded.is_encrypt,
        remote_create_time=excluded.remote_create_time, remote_sync_time=excluded.remote_sync_time,
        remote_version=excluded.remote_version, audio_object_name=excluded.audio_object_name,
        audio_duration_ms=excluded.audio_duration_ms, transcript_object_name=excluded.transcript_object_name,
        detail_json=excluded.detail_json, updated_at=excluded.updated_at
    `).run(
      detail.noteId, detail.userId, detail.type, detail.title, detail.dirId, detail.dirName,
      detail.isEncrypt, detail.createTime, detail.syncTime, detail.rawDetail?.version || '',
      detail.audioObjectName || '', detail.durationMs || 0, detail.transcriptObjectName || '',
      asJson(detail.rawDetail), timestamp, timestamp
    );
    return this.getCloudNote(detail.noteId);
  },

  getCloudNote(noteId) {
    const row = getDb().prepare(`SELECT * FROM cloud_note WHERE note_id = ?`).get(noteId);
    if (!row) return null;
    return { ...row, detail: parseJson(row.detail_json, null) };
  },

  setDownloadState(noteId, state, { errorCode = null, errorMessage = null, errorStage = null, downloadedAt = null } = {}) {
    getDb().prepare(`
      UPDATE cloud_note SET download_state = ?, download_error_code = ?, download_error_message = ?,
        download_error_stage = ?, downloaded_at = COALESCE(?, downloaded_at), updated_at = ?
      WHERE note_id = ?
    `).run(state, errorCode, errorMessage, errorStage, downloadedAt, now(), noteId);
  },

  replaceCloudSentences(noteId, sentences) {
    const database = getDb();
    database.exec('BEGIN');
    try {
      database.prepare('DELETE FROM cloud_sentence WHERE note_id = ?').run(noteId);
      const insert = database.prepare(`
        INSERT INTO cloud_sentence (note_id, ordinal, segment, speaker, begin_ms, end_ms, text)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      sentences.forEach((sentence, index) => {
        insert.run(noteId, index, Number(sentence.segment || 0), sentence.speaker || '说话人 1', Number(sentence.startTimeMs || 0), Number(sentence.endTimeMs || 0), sentence.text || '');
      });
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  },

  getCloudSentences(noteId) {
    return getDb().prepare(`SELECT ordinal, segment, speaker, begin_ms, end_ms, text FROM cloud_sentence WHERE note_id = ? ORDER BY ordinal`).all(noteId);
  },

  importNotebookMeeting(noteId, audioRelativePath) {
    const database = getDb();
    const note = this.getCloudNote(noteId);
    if (!note) throw new Error('本地索引中不存在该云笔记');
    const meetingId = `notebook:${noteId}`;
    const timestamp = now();
    database.prepare(`
      INSERT INTO project_meeting (
        meeting_id, source, cloud_note_id, title, created_at, duration_ms,
        audio_relative_path, audio_source, has_audio, updated_at
      ) VALUES (?, 'notebook', ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(meeting_id) DO UPDATE SET
        title=excluded.title, duration_ms=excluded.duration_ms, audio_relative_path=excluded.audio_relative_path,
        audio_source=excluded.audio_source, has_audio=excluded.has_audio, updated_at=excluded.updated_at
    `).run(
      meetingId, noteId, note.note_name || '办公本笔记', Number(note.remote_create_time || timestamp),
      Number(note.audio_duration_ms || 0), audioRelativePath || null,
      '讯飞办公本缓存录音（Ogg Opus）', note.audio_object_name ? 1 : 0, timestamp
    );
    const sentences = this.getCloudSentences(noteId);
    database.exec('BEGIN');
    try {
      database.prepare('DELETE FROM project_sentence WHERE meeting_id = ?').run(meetingId);
      const insert = database.prepare(`INSERT INTO project_sentence (meeting_id, ordinal, speaker, start_ms, end_ms, text, trans) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      sentences.forEach((s, index) => insert.run(meetingId, index, s.speaker, s.begin_ms, s.end_ms, s.text, ''));
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return this.getProjectMeeting(meetingId);
  },

  createRecordedMeeting({ title, durationMs = 0, sentences = [], audioBuffer = null, audioExtension = 'webm', audioMime = 'audio/webm; codecs=opus' }) {
    ensureNotebookStorage();
    const timestamp = now();
    const meetingId = `local:${timestamp}`;
    let audioRelativePath = null;
    if (audioBuffer?.length) {
      const extension = String(audioExtension || 'webm').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'webm';
      const absolutePath = path.join(NOTEBOOK_RECORDING_DIR, `${timestamp}.${extension}`);
      fs.writeFileSync(absolutePath, audioBuffer);
      audioRelativePath = getRelativeNotebookPath(absolutePath);
    }
    const database = getDb();
    database.prepare(`
      INSERT INTO project_meeting (meeting_id, source, title, created_at, duration_ms, audio_relative_path, audio_source, has_audio, updated_at)
      VALUES (?, 'recording', ?, ?, ?, ?, ?, ?, ?)
    `).run(meetingId, title || `会议记录_${new Date(timestamp).toLocaleDateString('zh-CN')}`, timestamp, Number(durationMs || 0), audioRelativePath, `VIAIM Studio 本地录音（${audioMime}）`, audioRelativePath ? 1 : 0, timestamp);
    const insert = database.prepare(`INSERT INTO project_sentence (meeting_id, ordinal, speaker, start_ms, end_ms, text, trans) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    sentences.forEach((s, index) => insert.run(meetingId, index, s.speaker || '我', Number(s.startTimeMs || index * 3000), Number(s.endTimeMs || (index + 1) * 3000), s.text || '', s.trans || ''));
    return this.getProjectMeeting(meetingId);
  },

  // 整体替换某场会议的转写句子（用于录音结束后的离线 ASR 转写落库）
  replaceProjectSentences(meetingId, sentences) {
    const database = getDb();
    database.exec('BEGIN');
    try {
      database.prepare('DELETE FROM project_sentence WHERE meeting_id = ?').run(meetingId);
      const insert = database.prepare(`INSERT INTO project_sentence (meeting_id, ordinal, speaker, start_ms, end_ms, text, trans) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      sentences.forEach((s, index) => insert.run(meetingId, index, s.speaker || '我', Number(s.startMs || index * 3000), Number(s.endMs || (index + 1) * 3000), s.text || '', s.trans || ''));
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return this.getProjectMeeting(meetingId);
  },

  getProjectMeeting(meetingId) {
    const row = getDb().prepare(`SELECT * FROM project_meeting WHERE meeting_id = ? AND deleted_at IS NULL`).get(meetingId);
    return row ? toMeeting(row, getSentences(meetingId), getTodos(meetingId)) : null;
  },

  getProjectMeetings() {
    return getDb().prepare(`SELECT * FROM project_meeting WHERE deleted_at IS NULL ORDER BY created_at DESC`).all()
      .map((row) => toMeeting(row, getSentences(row.meeting_id), getTodos(row.meeting_id)));
  },

  getProjectAudioPath(meetingId) {
    const row = getDb().prepare(`SELECT audio_relative_path FROM project_meeting WHERE meeting_id = ? AND deleted_at IS NULL`).get(meetingId);
    return row?.audio_relative_path ? resolveNotebookPath(row.audio_relative_path) : null;
  },

  // 保存/读取 AI 提炼的会议纪要（对 viaim 与项目会议通用，按 meetingId 键）
  saveMeetingSummary(meetingId, summary) {
    getDb().prepare(`
      INSERT INTO meeting_summary (meeting_id, payload_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(meeting_id) DO UPDATE SET payload_json=excluded.payload_json, updated_at=excluded.updated_at
    `).run(meetingId, asJson(summary), now());
    return summary;
  },

  getMeetingSummary(meetingId) {
    return getStoredSummary(meetingId);
  },

  deleteProjectMeeting(meetingId) {
    const result = getDb().prepare(`UPDATE project_meeting SET deleted_at = ?, updated_at = ? WHERE meeting_id = ? AND deleted_at IS NULL`).run(now(), now(), meetingId);
    if (!result.changes) throw new Error('未找到可删除的项目会议');
    return { success: true, recordId: meetingId };
  },

  toggleProjectTodo(meetingId, todoId) {
    const database = getDb();
    const todo = database.prepare(`SELECT done FROM project_todo WHERE meeting_id = ? AND todo_id = ?`).get(meetingId, todoId);
    if (todo) database.prepare(`UPDATE project_todo SET done = ? WHERE meeting_id = ? AND todo_id = ?`).run(Number(todo.done) === 1 ? 0 : 1, meetingId, todoId);
    return getTodos(meetingId).map((t) => ({ id: t.todo_id, task: t.task, done: Number(t.done) === 1, owner: '参会人' }));
  },

  recordLegacyReplacement({ legacyMeetingId, noteId, replacementMeetingId, verification, backedUpAt, legacySoftDeletedAt, status }) {
    getDb().prepare(`
      INSERT INTO legacy_replacement (
        legacy_meeting_id, note_id, replacement_meeting_id, verification_json,
        backed_up_at, legacy_soft_deleted_at, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(legacy_meeting_id) DO UPDATE SET
        note_id=excluded.note_id, replacement_meeting_id=excluded.replacement_meeting_id,
        verification_json=excluded.verification_json, backed_up_at=excluded.backed_up_at,
        legacy_soft_deleted_at=excluded.legacy_soft_deleted_at, status=excluded.status
    `).run(
      legacyMeetingId, noteId, replacementMeetingId, asJson(verification),
      backedUpAt, legacySoftDeletedAt || null, status
    );
  },
};
