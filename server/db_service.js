import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const VIAIM_DB_PATH = process.env.VIAIM_DB_PATH || '/Users/yaban/Library/Preferences/com.viaim.vi/kitdata/db/kitdb.db';
const DB_PATH = VIAIM_DB_PATH;
const AUDIOS_DIR = '/Users/yaban/Library/Preferences/com.viaim.vi/kitdata/audios';

let db = null;

function getDb() {
  if (!db) {
    if (!fs.existsSync(DB_PATH)) {
      throw Object.assign(new Error(`VIAIM 数据库文件不存在: ${DB_PATH}`), { code: 'VIAIM_DB_MISSING' });
    }
    // 外部 VIAIM 数据库只读；项目新数据写入自有 notebook.db。
    db = new DatabaseSync(DB_PATH, { readOnly: true });
  }
  return db;
}

function formatDuration(ms) {
  if (!ms || isNaN(ms)) return '00:00';
  const totalSeconds = Math.floor(Number(ms) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  }
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function formatTimeFromMs(ms) {
  if (!ms || isNaN(ms)) return '00:00';
  const totalSeconds = Math.floor(Number(ms) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export const dbService = {
  // 获取所有真实会议列表
  getMeetings() {
    const database = getDb();
    const rows = database.prepare(`
      SELECT 
        ID, TITLE, SUBTITLE, CREATETIME, DURATION, 
        FILEPATHMP3, FILEPATH, OVERVIEW, SUMMARY, 
        ROLESIZE, HASROLESEPARATION
      FROM t_record 
      WHERE DELETE_FLAG = 0 OR DELETE_FLAG IS NULL
      ORDER BY CAST(CREATETIME AS INTEGER) DESC
    `).all();

    return rows.map(r => {
      // 统计句子数量
      const sentenceStat = database.prepare('SELECT count(*) as count FROM t_sentence WHERE RECORDID = ?').get(r.ID);
      // 统计待办数量
      const todoStat = database.prepare('SELECT count(*) as count FROM t_record_todo WHERE RECORDID = ?').get(r.ID);
      
      const remoteAudio = r.FILEPATHMP3 && /^https?:\/\//i.test(String(r.FILEPATHMP3))
        ? String(r.FILEPATHMP3)
        : null;
      const localAudioExists = !!(r.FILEPATHMP3 && fs.existsSync(r.FILEPATHMP3)) ||
                               fs.existsSync(path.join(AUDIOS_DIR, `${r.ID}.mp3`)) ||
                               fs.existsSync(path.join(AUDIOS_DIR, `${r.ID}.wav`));
      const hasAudio = localAudioExists || !!remoteAudio;

      const createdAtStr = !isNaN(Number(r.CREATETIME))
        ? new Date(Number(r.CREATETIME)).toISOString()
        : new Date().toISOString();

      return {
        id: String(r.ID),
        source: 'viaim',
        title: r.TITLE || '未命名会议记录',
        subtitle: r.SUBTITLE || '',
        createdAt: createdAtStr,
        duration: formatDuration(r.DURATION),
        durationMs: Number(r.DURATION) || 0,
        category: '日常记录',
        audioSource: remoteAudio ? '讯飞办公本云端录音' : 'VIAIM 会议录音耳机 / 麦克风',
        status: 'completed',
        speakerCount: r.ROLESIZE || 2,
        hasAudio,
        sentenceCount: sentenceStat ? sentenceStat.count : 0,
        todoCount: todoStat ? todoStat.count : 0,
        hasSummary: !!(r.SUMMARY || r.OVERVIEW),
        audioPath: r.FILEPATHMP3 || path.join(AUDIOS_DIR, `${r.ID}.mp3`)
      };
    });
  },

  // 获取单个会议的完整真实详情（句子、AI纪要、待办）
  getMeetingDetail(recordId) {
    const database = getDb();
    const record = database.prepare(`
      SELECT * FROM t_record WHERE ID = ?
    `).get(recordId);

    if (!record) return null;

    // 查句子
    const sentencesRows = database.prepare(`
      SELECT 
        ID, SENTENCEID, RECORDID, CONTENT, STARTTIME, ENDTIME, 
        ROLENAME, ROLEID, TRANSLATION
      FROM t_sentence 
      WHERE RECORDID = ? 
      ORDER BY CAST(STARTTIME AS INTEGER) ASC
    `).all(recordId);

    const sentences = sentencesRows.map(s => ({
      id: String(s.ID),
      speaker: s.ROLENAME || `说话人 ${s.ROLEID || '1'}`,
      time: formatTimeFromMs(s.STARTTIME),
      startTimeMs: Number(s.STARTTIME) || 0,
      endTimeMs: Number(s.ENDTIME) || 0,
      text: s.CONTENT || '',
      trans: s.TRANSLATION || ''
    }));

    // 查真实待办
    const todosRows = database.prepare(`
      SELECT ID, TEXT, CHECKED FROM t_record_todo WHERE RECORDID = ? ORDER BY CAST(SORT AS INTEGER) ASC, CAST(ID AS INTEGER) ASC
    `).all(recordId);

    const todos = todosRows.map(t => ({
      id: String(t.ID),
      task: t.TEXT || '',
      done: Number(t.CHECKED) === 1,
      owner: '参会人'
    }));

    // 解析议题 topics（从 SUMMARY 中提取二级或三级标题）
    const topics = [];
    if (record.SUMMARY) {
      const topicMatches = record.SUMMARY.matchAll(/-\s+主题[一二三四五六七八九十0-9]+[：:]([^\n]+)/g);
      for (const m of topicMatches) {
        if (m[1]) topics.push(m[1].trim());
      }
    }

    // 优先用云端直链（http(s)://），其次用本地物理文件
    const remoteAudio = record.FILEPATHMP3 && /^https?:\/\//i.test(String(record.FILEPATHMP3))
      ? String(record.FILEPATHMP3)
      : null;
    const localAudioExists = !!(record.FILEPATHMP3 && fs.existsSync(record.FILEPATHMP3)) ||
                             fs.existsSync(path.join(AUDIOS_DIR, `${record.ID}.mp3`)) ||
                             fs.existsSync(path.join(AUDIOS_DIR, `${record.ID}.wav`));
    const hasAudio = localAudioExists || !!remoteAudio;

    return {
      id: String(record.ID),
      source: 'viaim',
      title: record.TITLE || '未命名会议记录',
      subtitle: record.SUBTITLE || '',
      createdAt: !isNaN(Number(record.CREATETIME)) ? new Date(Number(record.CREATETIME)).toISOString() : new Date().toISOString(),
      duration: formatDuration(record.DURATION),
      durationMs: Number(record.DURATION) || 0,
      category: '日常记录',
      audioSource: remoteAudio ? '讯飞办公本云端录音 (HTTPS 直链)' : 'VIAIM 录音耳机 (WebRTC AEC3)',
      status: 'completed',
      speakerCount: record.ROLESIZE || 2,
      hasAudio,
      audioUrl: remoteAudio || (localAudioExists ? `/api/audio/${record.ID}` : null),
      sentences,
      aiSummary: {
        generated: !!(record.SUMMARY || record.OVERVIEW),
        title: record.TITLE || '',
        abstract: record.OVERVIEW || '',
        summaryFull: record.SUMMARY || '',
        topics: topics.length > 0 ? topics : ['会议重点议题研讨', '技术选型与推进策略'],
        todos
      }
    };
  },

  // 获取真实录音文件物理路径
  getAudioFilePath(recordId) {
    const mp3 = path.join(AUDIOS_DIR, `${recordId}.mp3`);
    if (fs.existsSync(mp3)) return mp3;
    const wav = path.join(AUDIOS_DIR, `${recordId}.wav`);
    if (fs.existsSync(wav)) return wav;
    
    // 查库中字段
    const database = getDb();
    const r = database.prepare('SELECT FILEPATHMP3, FILEPATH FROM t_record WHERE ID = ?').get(recordId);
    if (r) {
      if (r.FILEPATHMP3 && fs.existsSync(r.FILEPATHMP3)) return r.FILEPATHMP3;
      if (r.FILEPATH && fs.existsSync(r.FILEPATH)) return r.FILEPATH;
    }
    return null;
  },

  // 保存新录制的真实会议
  createRecordedMeeting({ title, durationMs, sentences = [], audioBuffer = null, remoteAudioUrl = null }) {
    const database = getDb();
    const id = String(Date.now());
    const createTime = String(Date.now());
    let audioPath = '';

    if (audioBuffer && audioBuffer.length > 0) {
      if (!fs.existsSync(AUDIOS_DIR)) {
        fs.mkdirSync(AUDIOS_DIR, { recursive: true });
      }
      audioPath = path.join(AUDIOS_DIR, `${id}.mp3`);
      fs.writeFileSync(audioPath, audioBuffer);
    } else if (remoteAudioUrl && typeof remoteAudioUrl === 'string' && remoteAudioUrl.startsWith('http')) {
      // 云端 URL 暂存为占位路径；前端 <audio> 会通过 audioUrl 字段直读云端
      audioPath = remoteAudioUrl;
    }

    // 写入 t_record
    database.prepare(`
      INSERT INTO t_record (
        ID, TITLE, CREATETIME, DURATION, FILEPATHMP3, FILEPATH, DELETE_FLAG
      ) VALUES (?, ?, ?, ?, ?, ?, 0)
    `).run(id, title || `会议记录_${new Date().toLocaleDateString()}`, createTime, durationMs || 0, audioPath, audioPath);

    // 写入句子
    if (sentences.length > 0) {
      const insertStmt = database.prepare(`
        INSERT INTO t_sentence (
          ID, SENTENCEID, RECORDID, CONTENT, STARTTIME, ENDTIME, ROLENAME, TRANSLATION
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      sentences.forEach((s, idx) => {
        const sId = `${id}_${idx}`;
        insertStmt.run(
          sId,
          String(idx),
          id,
          s.text || '',
          String(s.startTimeMs || idx * 3000),
          String(s.endTimeMs || (idx + 1) * 3000),
          s.speaker || '我',
          s.trans || ''
        );
      });
    }

    return this.getMeetingDetail(id);
  },

  // 删除会议记录（软删除）
  deleteMeeting(recordId) {
    const database = getDb();
    // 软删除：标记 DELETE_FLAG = 1
    database.prepare(`
      UPDATE t_record SET DELETE_FLAG = 1 WHERE ID = ?
    `).run(recordId);
    // 同时删除关联的句子和待办
    database.prepare('DELETE FROM t_sentence WHERE RECORDID = ?').run(recordId);
    database.prepare('DELETE FROM t_record_todo WHERE RECORDID = ?').run(recordId);
    return { success: true, recordId };
  },

  // 切换待办状态
  toggleTodo(recordId, todoId) {
    const database = getDb();
    const current = database.prepare(`
      SELECT CHECKED FROM t_record_todo WHERE RECORDID = ? AND ID = ?
    `).get(recordId, todoId);

    if (current) {
      const nextChecked = Number(current.CHECKED) === 1 ? 0 : 1;
      database.prepare(`
        UPDATE t_record_todo SET CHECKED = ? WHERE RECORDID = ? AND ID = ?
      `).run(nextChecked, recordId, todoId);
    }

    return database.prepare(`
      SELECT ID, TEXT, CHECKED FROM t_record_todo WHERE RECORDID = ?
    `).all(recordId).map(t => ({
      id: String(t.ID),
      task: t.TEXT,
      done: Number(t.CHECKED) === 1,
      owner: '参会人'
    }));
  }
};
