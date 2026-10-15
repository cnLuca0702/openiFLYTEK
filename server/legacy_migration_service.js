import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VIAIM_DB_PATH } from './db_service.js';
import { NOTEBOOK_BACKUP_DIR, ensureNotebookStorage } from './storage_paths.js';
import { notebookStore } from './notebook_store.js';

function utcStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function quoteSqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function getReadonlyDb() {
  if (!fs.existsSync(VIAIM_DB_PATH)) throw new Error('未找到 VIAIM 外部数据库');
  return new DatabaseSync(VIAIM_DB_PATH, { readOnly: true });
}

function candidateFromRow(row) {
  return {
    legacyMeetingId: String(row.ID),
    title: row.TITLE || '未命名办公本旧记录',
    createdAt: Number(row.CREATETIME || 0),
    durationMs: Number(row.DURATION || 0),
    audioPath: row.FILEPATHMP3 || '',
    deleted: Number(row.DELETE_FLAG || 0) === 1,
  };
}

export class LegacyMigrationService {
  constructor(notebookIntegration) {
    this.notebookIntegration = notebookIntegration;
  }

  listCandidates() {
    const database = getReadonlyDb();
    try {
      const rows = database.prepare(`
        SELECT ID, TITLE, CREATETIME, DURATION, FILEPATHMP3, DELETE_FLAG
        FROM t_record
        WHERE TITLE LIKE '[办公本]%'
        ORDER BY CAST(CREATETIME AS INTEGER) DESC
      `).all();
      return rows.map(candidateFromRow);
    } finally {
      database.close();
    }
  }

  getCandidate(legacyMeetingId) {
    const database = getReadonlyDb();
    try {
      const row = database.prepare(`
        SELECT ID, TITLE, CREATETIME, DURATION, FILEPATHMP3, DELETE_FLAG
        FROM t_record WHERE ID = ?
      `).get(legacyMeetingId);
      if (!row || !String(row.TITLE || '').startsWith('[办公本]')) {
        throw new Error('未找到可迁移的办公本旧记录');
      }
      return candidateFromRow(row);
    } finally {
      database.close();
    }
  }

  backupExternalDatabase() {
    ensureNotebookStorage();
    const target = path.join(NOTEBOOK_BACKUP_DIR, `kitdb-before-legacy-migration-${utcStamp()}.db`);
    const database = new DatabaseSync(VIAIM_DB_PATH);
    try {
      // VACUUM INTO 生成一致性 SQLite 副本，不依赖直接复制可能遗漏的 WAL 文件。
      database.exec(`VACUUM INTO ${quoteSqlLiteral(target)}`);
    } finally {
      database.close();
    }
    if (!fs.existsSync(target) || fs.statSync(target).size === 0) {
      throw new Error('迁移前数据库备份失败');
    }
    return target;
  }

  verifyReplacement(noteId, replacement) {
    const note = notebookStore.getCloudNote(noteId);
    if (!note) throw new Error('替代云笔记未写入项目索引');
    if (!replacement || replacement.cloudNoteId !== noteId) throw new Error('替代会议与云笔记映射不一致');
    if (Number(replacement.durationMs || 0) <= 0) throw new Error('替代会议缺少有效时长，不能删除旧记录');

    let audio = null;
    if (replacement.hasAudio) {
      const audioPath = notebookStore.getProjectAudioPath(replacement.id);
      if (!audioPath || !fs.existsSync(audioPath) || fs.statSync(audioPath).size < 5) {
        throw new Error('替代会议未找到有效音频缓存，不能删除旧记录');
      }
      const magic = fs.readFileSync(audioPath).subarray(0, 4).toString('latin1');
      if (magic !== 'OggS') throw new Error('替代会议音频格式校验失败，不能删除旧记录');
      audio = { path: audioPath, bytes: fs.statSync(audioPath).size, magic };
    }
    const sentenceCount = Number(replacement.sentenceCount || replacement.sentences?.length || 0);
    if (note.transcript_object_name && sentenceCount === 0) {
      throw new Error('替代会议转写为空，不能删除旧记录');
    }
    return {
      checkedAt: new Date().toISOString(),
      meetingId: replacement.id,
      noteId,
      durationMs: replacement.durationMs,
      sentenceCount,
      audio,
      transcriptObjectName: note.transcript_object_name || null,
    };
  }

  async replaceLegacyRecord({ legacyMeetingId, noteId, confirmLegacyId }) {
    if (!legacyMeetingId || !noteId || confirmLegacyId !== legacyMeetingId) {
      throw new Error('迁移确认信息不完整；必须明确确认待替换的旧记录');
    }
    const candidate = this.getCandidate(legacyMeetingId);
    const download = await this.notebookIntegration.downloadNote(noteId, { includeTranscript: true });
    if (download.state !== 'ready') throw new Error('替代云笔记未完成下载');
    const replacement = await this.notebookIntegration.importNote(noteId);
    const verification = this.verifyReplacement(noteId, replacement);
    const backupPath = this.backupExternalDatabase();
    const backedUpAt = Date.now();

    if (!candidate.deleted) {
      const database = new DatabaseSync(VIAIM_DB_PATH);
      try {
        const result = database.prepare('UPDATE t_record SET DELETE_FLAG = 1 WHERE ID = ? AND (DELETE_FLAG = 0 OR DELETE_FLAG IS NULL)').run(legacyMeetingId);
        if (result.changes !== 1) throw new Error('旧记录软删除未生效；已保留替代会议和备份，未删除任何旧数据');
      } finally {
        database.close();
      }
    }

    const deletedAt = Date.now();
    notebookStore.recordLegacyReplacement({
      legacyMeetingId,
      noteId,
      replacementMeetingId: replacement.id,
      verification: { ...verification, backupPath, legacyPreviouslyDeleted: candidate.deleted },
      backedUpAt,
      legacySoftDeletedAt: deletedAt,
      status: candidate.deleted ? 'already_soft_deleted' : 'replaced_and_soft_deleted',
    });

    return {
      legacyMeetingId,
      noteId,
      replacementMeetingId: replacement.id,
      backupPath,
      status: candidate.deleted ? 'already_soft_deleted' : 'replaced_and_soft_deleted',
      verification,
    };
  }
}
