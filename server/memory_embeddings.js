import { createHash } from 'node:crypto';
import { loadConfig } from './llm_config.js';

export function embeddingRuntime() {
  const c = loadConfig().embedding || {};
  if (!c.enabled || !c.baseUrl || !c.model) return null;
  const url = new URL(c.baseUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('无效向量服务地址');
  const baseUrl = url.href.replace(/\/+$/, '');
  return { baseUrl, model: c.model, apiKey: c.apiKey || '', key: createHash('sha256').update(JSON.stringify([baseUrl,c.model])).digest('hex') };
}
export function normalizeVector(v) {
  if (!Array.isArray(v) || !v.length || v.length > 8192 || v.some(n => typeof n !== 'number' || !Number.isFinite(n))) throw new Error('无效向量');
  const norm = Math.hypot(...v);
  if (!norm || !Number.isFinite(norm)) throw new Error('无效向量');
  return v.map(n => n / norm);
}
export async function embedTexts(runtime, texts, {fetcher = fetch, timeout = 15000} = {}) {
  const response = await fetcher(`${runtime.baseUrl}/embeddings`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: {'Content-Type':'application/json', ...(runtime.apiKey ? {Authorization:`Bearer ${runtime.apiKey}`} : {})},
    body: JSON.stringify({model:runtime.model,input:texts,encoding_format:'float'}),
  });
  if (!response.ok) throw new Error('向量服务暂不可用');
  const body = await response.json();
  if (!Array.isArray(body.data) || body.data.length !== texts.length) throw new Error('向量数量不匹配');
  const ordered = [...body.data].sort((a,b)=>a.index-b.index);
  if (ordered.some((r,i)=>r.index!==i)) throw new Error('向量索引不匹配');
  const vectors = ordered.map(r=>normalizeVector(r.embedding));
  if (vectors.some(v=>v.length!==vectors[0].length)) throw new Error('向量维度不一致');
  return vectors;
}

export class MemoryEmbeddings {
  constructor(store, {runtime = embeddingRuntime, embed = embedTexts} = {}) {
    Object.assign(this,{store,runtime,embed}); this.working=false; this.stopped=false;
    store.db.exec(`CREATE TABLE IF NOT EXISTS memory_vectors (
      profile TEXT NOT NULL, chunk_id INTEGER NOT NULL, dimensions INTEGER NOT NULL, vector TEXT NOT NULL,
      PRIMARY KEY(profile,chunk_id));
      CREATE TABLE IF NOT EXISTS memory_vector_retry(profile TEXT PRIMARY KEY, attempts INTEGER NOT NULL, retry_at INTEGER NOT NULL);`);
  }
  config() { try {return this.runtime();} catch {return null;} }
  pending(profile) {
    return this.store.db.prepare(`SELECT c.id,c.text FROM memory_chunks c JOIN memory_sources s ON s.id=c.source_id
      LEFT JOIN memory_vectors v ON v.chunk_id=c.id AND v.profile=?
      WHERE s.active=1 AND c.version=s.version AND v.chunk_id IS NULL ORDER BY c.id LIMIT 16`).all(profile);
  }
  status() {
    const c=this.config();
    if(!c)return {state:'unconfigured', indexed:0, pending:0};
    const counts=this.store.db.prepare(`SELECT count(*) total,count(v.chunk_id) indexed_count FROM memory_chunks c
      JOIN memory_sources s ON s.id=c.source_id LEFT JOIN memory_vectors v ON v.chunk_id=c.id AND v.profile=?
      WHERE s.active=1 AND c.version=s.version`).get(c.key);
    const retry=this.store.db.prepare('SELECT retry_at FROM memory_vector_retry WHERE profile=?').get(c.key);
    return {state:retry?.retry_at>Date.now()?'retrying':counts.total>counts.indexed_count?'indexing':'ready',indexed:counts.indexed_count,pending:counts.total-counts.indexed_count};
  }
  async tick() {
    if(this.working||this.stopped)return;
    const c=this.config();if(!c)return;
    const retry=this.store.db.prepare('SELECT * FROM memory_vector_retry WHERE profile=?').get(c.key);
    if(retry?.retry_at>Date.now())return;
    const rows=this.pending(c.key);if(!rows.length)return;
    this.working=true;
    try {
      const vectors=await this.embed(c,rows.map(r=>r.text));
      if(this.stopped||this.config()?.key!==c.key)return;
      if(vectors.length!==rows.length)throw Error('向量数量不匹配');
      const normalized=vectors.map(normalizeVector);
      const dim=this.store.db.prepare('SELECT dimensions FROM memory_vectors WHERE profile=? LIMIT 1').get(c.key)?.dimensions || normalized[0].length;
      if(normalized.some(v=>v.length!==dim))throw Error('向量维度变更，请使用独立模型名称');
      this.store.transaction(()=>{
        rows.forEach((r,i)=>{if(this.store.evidence(r.id))this.store.db.prepare('INSERT OR REPLACE INTO memory_vectors VALUES(?,?,?,?)').run(c.key,r.id,dim,JSON.stringify(normalized[i]));});
        this.store.db.prepare('DELETE FROM memory_vector_retry WHERE profile=?').run(c.key);
      });
    } catch {
      if(!this.stopped)this.store.db.prepare('INSERT OR REPLACE INTO memory_vector_retry VALUES(?,?,?)').run(c.key,(retry?.attempts||0)+1,Date.now()+Math.min(3600000,30000*2**Math.min(retry?.attempts||0,7)));
    } finally {this.working=false;}
  }
  async search(question, {meetingIds=[],limit=12}={}) {
    const c=this.config();if(!c)return [];
    const retry=this.store.db.prepare('SELECT retry_at FROM memory_vector_retry WHERE profile=?').get(c.key);
    if(retry?.retry_at>Date.now())return [];
    // No external query request until there is a usable local vector index.
    const scope=meetingIds.length?` AND s.id IN (${meetingIds.map(()=>'?').join(',')})`:'';
    const rows=this.store.db.prepare(`SELECT v.* FROM memory_vectors v JOIN memory_chunks c ON c.id=v.chunk_id
      JOIN memory_sources s ON s.id=c.source_id WHERE v.profile=? AND s.active=1 AND c.version=s.version ${scope}`).all(c.key,...meetingIds);
    if(!rows.length)return [];
    const [raw]=await this.embed(c,[question],{timeout:4000});
    if(this.stopped||this.config()?.key!==c.key)return [];
    const query=normalizeVector(raw);
    if(rows.some(r=>r.dimensions!==query.length))throw new Error('查询向量维度与索引不一致');
    const scores=[];
    for(const row of rows) {
      if(row.dimensions!==query.length)continue;
      const vector=JSON.parse(row.vector);
      const score=vector.reduce((sum,n,i)=>sum+n*query[i],0);
      if(score>=0.45)scores.push({id:row.chunk_id,score});
    }
    return scores.sort((a,b)=>b.score-a.score).slice(0,limit).map(r=>this.store.evidence(r.id)).filter(Boolean);
  }
  start(){this.stopped=false;this.timer=setInterval(()=>void this.tick(),10000);this.timer.unref();void this.tick();}
  stop(){this.stopped=true;clearInterval(this.timer);}
}

export function fuseEvidence(lexical, semantic, limit=12) {
  const result=new Map();
  for(const list of [lexical,semantic])list.forEach((c,i)=>{
    const item=result.get(c.chunkId)||{citation:c,score:0};item.score+=1/(60+i+1);result.set(c.chunkId,item);
  });
  return [...result.values()].sort((a,b)=>b.score-a.score).slice(0,limit).map(r=>r.citation);
}
