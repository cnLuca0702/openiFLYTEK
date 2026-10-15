// Automatic memory is a projection of source meetings, never a replacement for them.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { validateFollowup, buildFollowups } from './memory_followups.js';
import { validateStructure, buildProjectMemory } from './memory_graph.js';

const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const STOP = new Set(['什么', '时候', '怎么', '哪些', '有没有', '这个', '那个', '我们', '一下', '请问', '目前', '现在', '之前', '最近', '是否', '进行', '一个', '可以', '已经', '的', '了', '是', '吗']);
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
export function tokens(text) {
  const words = [...segmenter.segment(String(text).normalize('NFKC').toLowerCase())]
    .filter((s) => s.isWordLike && !STOP.has(s.segment)).map((s) => s.segment);
  return [...new Set(words.flatMap((word) => {
    if (!/\p{Script=Han}/u.test(word)) return [word];
    const chars = [...word];
    return [word, ...chars.slice(0, -1).map((_, i) => chars.slice(i, i + 2).join(''))];
  }))];
}

export function snapshot(meeting) {
  const sentences = (meeting.sentences || []).map((s, index) => ({
    id: String(s.id ?? index), text: String(s.text || '').trim(), speaker: String(s.speaker || ''),
    startMs: Math.max(0, Number(s.startTimeMs) || 0), endMs: Math.max(0, Number(s.endTimeMs) || Number(s.startTimeMs) || 0),
  })).filter((s) => s.text && !/📌|重点标记点/.test(s.text));
  const data = { id: String(meeting.id), title: String(meeting.title || '未命名会议'), createdAt: String(meeting.createdAt || ''), sentences };
  return { ...data, version: hash(data) };
}

export function chunksOf(data) {
  const chunks = [];
  let group = [], size = 0;
  const flush = () => {
    if (!group.length) return;
    chunks.push({ ordinal: chunks.length, text: group.map((s) => `${s.speaker}: ${s.text}`).join('\n'),
      startMs: group[0].startMs, endMs: group.at(-1).endMs, sentenceIds: group.map((s) => s.id) });
    group = []; size = 0;
  };
  for (const sentence of data.sentences) {
    if (data.id.startsWith('document:')) flush();
    // Split pathological long ASR sentences without dropping their source identity.
    for (let offset = 0; offset < sentence.text.length; offset += 1100) {
      const s = { ...sentence, text: sentence.text.slice(offset, offset + 1100) };
      if (size + s.text.length > 1200) flush();
      group.push(s); size += s.text.length;
    }
  }
  flush();
  return chunks;
}

export class MemoryStore {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS memory_sources (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, occurred_at TEXT NOT NULL, version TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_chunks (
        id INTEGER PRIMARY KEY, source_id TEXT NOT NULL, version TEXT NOT NULL, ordinal INTEGER NOT NULL,
        text TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, sentence_ids TEXT NOT NULL,
        UNIQUE(source_id, version, ordinal));
      CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(terms);
      CREATE TABLE IF NOT EXISTS memory_keywords(chunk_id INTEGER PRIMARY KEY, text TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS memory_jobs (
        source_id TEXT NOT NULL, version TEXT NOT NULL, batch INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, retry_at INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(source_id,version,batch));
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL, version TEXT NOT NULL, chunk_id INTEGER NOT NULL,
        kind TEXT NOT NULL, subject TEXT NOT NULL, claim TEXT NOT NULL, quote TEXT NOT NULL,
        created_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS memory_chunks_source ON memory_chunks(source_id,version);
      CREATE INDEX IF NOT EXISTS memory_facts_source ON memory_facts(source_id,version);
    `);
    this.db.exec('CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    if (!this.db.prepare('PRAGMA table_info(memory_facts)').all().some((c) => c.name === 'structure_json')) {
      this.db.exec("ALTER TABLE memory_facts ADD COLUMN structure_json TEXT NOT NULL DEFAULT 'null'");
    }
    if (!this.db.prepare('PRAGMA table_info(memory_facts)').all().some(c => c.name === 'followup_json')) this.db.exec("ALTER TABLE memory_facts ADD COLUMN followup_json TEXT NOT NULL DEFAULT 'null'");
    // One-time upgrade: old facts remain usable as raw evidence while v2 jobs backfill.
    this.transaction(() => {
      if (this.db.prepare("SELECT value FROM memory_meta WHERE key='extractor_version'").get()?.value !== '3') {
        this.db.exec("UPDATE memory_jobs SET state='pending',attempts=0,retry_at=0");
        this.db.prepare("INSERT OR REPLACE INTO memory_meta VALUES('extractor_version','3')").run();
      }
      this.db.prepare("UPDATE memory_jobs SET state='pending' WHERE state='running'").run();
    });
    const expected = this.db.prepare('SELECT count(*) n FROM memory_chunks c JOIN memory_sources s ON s.id=c.source_id WHERE s.active=1 AND s.version=c.version').get().n;
    if (this.db.prepare('SELECT count(*) n FROM memory_fts').get().n !== expected) this.rebuildIndex();
  }
  indexChunk(id, title, text) {
    const facts = this.db.prepare('SELECT subject,claim FROM memory_facts WHERE chunk_id=?').all(id);
    const keywords = this.db.prepare('SELECT text FROM memory_keywords WHERE chunk_id=?').get(id)?.text || '';
    const terms = tokens([title, text, keywords, ...facts.map((f) => `${f.subject} ${f.claim}`)].join(' ')).join(' ');
    this.db.prepare('DELETE FROM memory_fts WHERE rowid=?').run(id);
    this.db.prepare('INSERT INTO memory_fts(rowid,terms) VALUES(?,?)').run(id, terms);
  }
  rebuildIndex() {
    this.transaction(() => {
      this.db.exec('DELETE FROM memory_fts');
      const rows = this.db.prepare('SELECT c.*,s.title FROM memory_chunks c JOIN memory_sources s ON s.id=c.source_id WHERE s.active=1 AND s.version=c.version').all();
      for (const row of rows) this.indexChunk(row.id, row.title, row.text);
    });
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  upsert(meeting) {
    const data = snapshot(meeting);
    const old = this.db.prepare('SELECT * FROM memory_sources WHERE id=?').get(data.id);
    if (old?.version === data.version && old.active) return false;
    return this.transaction(() => {
      this.db.prepare(`INSERT INTO memory_sources VALUES(?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET
        title=excluded.title, occurred_at=excluded.occurred_at, version=excluded.version, active=1, updated_at=excluded.updated_at`)
        .run(data.id, data.title, data.createdAt, data.version, Date.now());
      // Historical chunks/facts remain for audit, but leave the current retrieval surface.
      this.db.prepare('DELETE FROM memory_fts WHERE rowid IN (SELECT id FROM memory_chunks WHERE source_id=?)').run(data.id);
      const chunks = chunksOf(data);
      for (const chunk of chunks) {
        this.db.prepare(`INSERT OR IGNORE INTO memory_chunks(source_id,version,ordinal,text,start_ms,end_ms,sentence_ids) VALUES(?,?,?,?,?,?,?)`)
          .run(data.id, data.version, chunk.ordinal, chunk.text, chunk.startMs, chunk.endMs, JSON.stringify(chunk.sentenceIds));
        const row = this.db.prepare('SELECT id FROM memory_chunks WHERE source_id=? AND version=? AND ordinal=?').get(data.id, data.version, chunk.ordinal);
        this.indexChunk(row.id, data.title, chunk.text);
      }
      for (let batch = 0; batch < Math.ceil(chunks.length / 6); batch++) {
        this.db.prepare('INSERT OR IGNORE INTO memory_jobs(source_id,version,batch) VALUES(?,?,?)').run(data.id, data.version, batch);
      }
      return true;
    });
  }
  remove(id) {
    this.transaction(() => {
      this.db.prepare('UPDATE memory_sources SET active=0 WHERE id=?').run(id);
      this.db.prepare('DELETE FROM memory_fts WHERE rowid IN (SELECT id FROM memory_chunks WHERE source_id=?)').run(id);
    });
  }
  activeIds() { return this.db.prepare('SELECT id FROM memory_sources WHERE active=1').all().map((r) => r.id); }
  search(question, { meetingIds = [], limit = 12 } = {}) {
    const terms = tokens(question).slice(0, 64);
    if (!terms.length) return [];
    const scope = meetingIds.length ? ` AND s.id IN (${meetingIds.map(() => '?').join(',')})` : '';
    const rows = this.db.prepare(`SELECT c.*, s.title,s.occurred_at, bm25(memory_fts) AS rank
      FROM memory_fts JOIN memory_chunks c ON c.id=memory_fts.rowid JOIN memory_sources s ON s.id=c.source_id
      WHERE memory_fts MATCH ? AND s.active=1 AND c.version=s.version ${scope}
      ORDER BY rank LIMIT 100`).all(terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' OR '), ...meetingIds);
    const seen = new Map();
    // Reserve coverage across meetings; then fill with remaining relevant passages.
    const diverse = [], rest = [];
    for (const row of rows) {
      const count = seen.get(row.source_id) || 0;
      (count < 2 ? diverse : rest).push(row); seen.set(row.source_id, count + 1);
    }
    return [...diverse, ...rest].slice(0, limit).map((r) => this.citation(r));
  }
  contextFor(meetingIds, limit = 12) {
    const groups = meetingIds.map((id) => this.db.prepare(`SELECT c.*,s.title,s.occurred_at FROM memory_chunks c
      JOIN memory_sources s ON s.id=c.source_id WHERE s.id=? AND s.active=1 AND c.version=s.version ORDER BY c.ordinal`).all(id));
    const perMeeting = Math.max(1, Math.floor(limit / Math.max(1, groups.length)));
    return groups.flatMap((rows) => {
      if (rows.length <= perMeeting) return rows;
      // Overview only: sample throughout, not merely the beginning of a long meeting.
      return Array.from({ length: perMeeting }, (_, i) => rows[Math.floor(i * (rows.length - 1) / Math.max(1, perMeeting - 1))]);
    }).slice(0, limit).map((r) => this.citation(r));
  }
  citation(r) {
    const facts = this.db.prepare('SELECT id,kind,subject,claim,quote FROM memory_facts WHERE chunk_id=? AND version=?').all(r.id, r.version);
    return { location: r.source_id.startsWith('document:') ? r.text.split(':')[0].slice(0,100) : '', sourceType: r.source_id.startsWith('document:') ? 'document' : 'meeting',
      pages: r.source_id.startsWith('document:') ? [...new Set(JSON.parse(r.sentence_ids).map(id => Number(id.split(':')[1])))] : [],
      chunkId: Number(r.id), meetingId: r.source_id, version: r.version, title: r.title,
      occurredAt: r.occurred_at, startMs: r.start_ms, endMs: r.end_ms,
      sentenceIds: JSON.parse(r.sentence_ids), excerpt: r.text, facts };
  }
  evidence(id) {
    const row = this.db.prepare(`SELECT c.*,s.title,s.occurred_at FROM memory_chunks c JOIN memory_sources s ON s.id=c.source_id
      WHERE c.id=? AND s.active=1 AND c.version=s.version`).get(id);
    return row ? this.citation(row) : null;
  }
  nextJob() {
    const job = this.db.prepare(`SELECT j.*,s.title,s.occurred_at FROM memory_jobs j JOIN memory_sources s ON s.id=j.source_id
      WHERE s.active=1 AND j.version=s.version AND j.state='pending' AND j.retry_at<=? ORDER BY j.retry_at,j.rowid LIMIT 1`).get(Date.now());
    if (!job) return null;
    this.db.prepare("UPDATE memory_jobs SET state='running' WHERE source_id=? AND version=? AND batch=?").run(job.source_id, job.version, job.batch);
    return { ...job, chunks: this.db.prepare('SELECT * FROM memory_chunks WHERE source_id=? AND version=? AND ordinal>=? AND ordinal<? ORDER BY ordinal')
      .all(job.source_id, job.version, job.batch * 6, (job.batch + 1) * 6) };
  }
  finishJob(job, facts) {
    return this.transaction(() => {
      const current = this.db.prepare('SELECT version,active FROM memory_sources WHERE id=?').get(job.source_id);
      if (current?.active && current.version === job.version) {
        const knownAt = new Map(this.db.prepare('SELECT id,created_at FROM memory_facts WHERE source_id=? AND version=?')
          .all(job.source_id, job.version).map((f) => [f.id, f.created_at]));
        // Replace only this successfully re-extracted batch, atomically. Old jobs cannot resurrect evidence.
        for (const chunk of job.chunks) this.db.prepare('DELETE FROM memory_facts WHERE chunk_id=?').run(chunk.id);
        for (const fact of facts.slice(0, 24)) {
          const chunk = job.chunks.find((c) => c.id === Number(fact.chunkId));
          if (!chunk || !['decision', 'commitment', 'task', 'fact', 'proposal', 'change', 'question', 'resolution'].includes(fact.kind)) continue;
          const quote = String(fact.quote || '').trim(), claim = String(fact.claim || '').trim(), subject = String(fact.subject || '').trim();
          if (quote.length < 4 || !chunk.text.includes(quote) || !claim || claim.length > 500 || !subject || subject.length > 100) continue;
          const id = hash([job.source_id, job.version, chunk.id, fact.kind, subject, claim]);
          this.db.prepare('INSERT OR IGNORE INTO memory_facts(id,source_id,version,chunk_id,kind,subject,claim,quote,created_at,structure_json,followup_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(
            id, job.source_id, job.version, chunk.id,
            fact.kind, subject, claim, quote, knownAt.get(id) || Date.now(), JSON.stringify(validateStructure(fact, chunk, job.occurred_at)), JSON.stringify(validateFollowup(fact)));
        }
        for (const chunk of job.chunks) this.indexChunk(chunk.id, job.title, chunk.text);
      }
      this.db.prepare("UPDATE memory_jobs SET state='done' WHERE source_id=? AND version=? AND batch=?").run(job.source_id, job.version, job.batch);
    });
  }
  failJob(job) {
    const delay = Math.min(86400000, 60000 * 2 ** Math.min(job.attempts, 10));
    this.db.prepare("UPDATE memory_jobs SET state='pending',attempts=attempts+1,retry_at=? WHERE source_id=? AND version=? AND batch=?")
      .run(Date.now() + delay, job.source_id, job.version, job.batch);
  }
  projectMemory({ meetingIds = [], now = Date.now() } = {}) {
    const scope = meetingIds.length ? ` AND s.id IN (${meetingIds.map(() => '?').join(',')})` : '';
    const facts = this.db.prepare(`SELECT f.*,s.occurred_at FROM memory_facts f JOIN memory_sources s ON s.id=f.source_id
      WHERE s.active=1 AND f.version=s.version AND f.structure_json!='null' ${scope}`).all(...meetingIds)
      .map((f) => ({ ...f, structure: JSON.parse(f.structure_json) }));
    return buildProjectMemory(facts, now);
  }
  followups(now=Date.now()) {
    const facts=this.db.prepare(`SELECT f.*,s.occurred_at FROM memory_facts f JOIN memory_sources s ON s.id=f.source_id
      WHERE s.active=1 AND f.version=s.version AND f.followup_json!='null'`).all().map(f=>({...f,followup:JSON.parse(f.followup_json)}));
    return buildFollowups(facts,now);
  }
  status() {
    return { sources: this.db.prepare('SELECT count(*) n FROM memory_sources WHERE active=1').get().n,
      facts: this.db.prepare('SELECT count(*) n FROM memory_facts f JOIN memory_sources s ON s.id=f.source_id WHERE s.active=1 AND f.version=s.version').get().n,
      pending: this.db.prepare("SELECT count(*) n FROM memory_jobs j JOIN memory_sources s ON s.id=j.source_id WHERE s.active=1 AND j.version=s.version AND j.state!='done'").get().n };
  }
  close() { this.db.close(); }
}
