import { normalize } from './memory_graph.js';

// Retrieval links only. These identities never participate in state replacement or completion.
export function evidenceEntities(fact) {
  const entities=[];
  const add=(type,name,scope='')=>{
    if(typeof name!=='string'||typeof scope!=='string')return;
    name=name.trim();scope=scope.trim();
    if(name.length<2||name.length>100||scope.length>100||!fact.quote.includes(name)||(scope&&!fact.quote.includes(scope)))return;
    if(!['concept','technology','product','project','organization','person'].includes(type))return;
    if(['project','product','person'].includes(type)&&!scope)return;
    entities.push({type,name,scope,key:JSON.stringify([type,normalize(scope),normalize(name)])});
  };
  for(const e of (Array.isArray(fact.entities)?fact.entities:[]).slice(0,12))if(e&&typeof e==='object')add(e.type,e.name,e.scope||'');
  const e=fact.structure?.entity;if(e)add('project',e.name,e.scope);
  return [...new Map(entities.map(e=>[e.key,e])).values()];
}

export function relatedEvidence(store, seeds, {meetingIds=[],limit=8}={}) {
  if(!seeds.length)return [];
  const seedIds=seeds.map(c=>c.chunkId);
  const marks=seedIds.map(()=>'?').join(',');
  const scope=meetingIds.length?` AND s.id IN (${meetingIds.map(()=>'?').join(',')})`:'';
  const rows=store.db.prepare(`SELECT target.chunk_id,count(DISTINCT target.entity_key) matches FROM memory_entity_links target
    JOIN memory_chunks c ON c.id=target.chunk_id JOIN memory_sources s ON s.id=c.source_id
    WHERE s.active=1 AND c.version=s.version ${scope}
    AND target.entity_key IN (SELECT DISTINCT e.entity_key FROM memory_entity_links e
      JOIN memory_chunks sc ON sc.id=e.chunk_id JOIN memory_sources ss ON ss.id=sc.source_id
      WHERE ss.active=1 AND sc.version=ss.version AND sc.id IN (${marks}))
    AND target.chunk_id NOT IN (${marks}) GROUP BY target.chunk_id ORDER BY matches DESC,target.chunk_id DESC LIMIT ?`)
    .all(...meetingIds,...seedIds,...seedIds,limit);
  return rows.map(r=>store.evidence(r.chunk_id)).filter(Boolean);
}
