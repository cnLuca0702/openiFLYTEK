// Read-only projection of current, readable evidence. No inferred graph edges.
export function memoryPanorama(memory) {
  const db=memory.store.db;
  const rows=db.prepare(`SELECT s.id,s.title,s.occurred_at,
    (SELECT min(id) FROM memory_chunks c WHERE c.source_id=s.id AND c.version=s.version) chunk_id,
    (SELECT count(*) FROM memory_chunks c WHERE c.source_id=s.id AND c.version=s.version) chunks,
    (SELECT count(*) FROM memory_facts f WHERE f.source_id=s.id AND f.version=s.version) facts
    FROM memory_sources s WHERE s.active=1 ORDER BY s.updated_at DESC LIMIT 500`).all();
  const sources=[];let unavailable=0;
  for(const row of rows) {
    const citation=memory.store.evidence(row.chunk_id);
    if(!citation||!memory.validate(citation)){unavailable++;continue;}
    const source=memory.getMeeting(row.id);
    sources.push({id:row.id,title:row.title,type:citation.sourceType,date:row.occurred_at,chunks:row.chunks,facts:row.facts,
      knowledgeUnits:(source?.knowledge||[]).reduce((n,g)=>n+g.units.length,0),citation});
  }
  const allowed=new Set(sources.map(s=>s.id)),topics=new Map();
  const links=db.prepare(`SELECT e.entity_key,c.source_id,count(DISTINCT e.fact_id) facts FROM memory_entity_links e
    JOIN memory_chunks c ON c.id=e.chunk_id JOIN memory_sources s ON s.id=c.source_id
    WHERE s.active=1 AND c.version=s.version GROUP BY e.entity_key,c.source_id`).all();
  for(const link of links) {
    if(!allowed.has(link.source_id))continue;
    const [type,scope,name]=JSON.parse(link.entity_key);
    const topic=topics.get(link.entity_key)||{id:link.entity_key,type,scope,name,sourceIds:[],facts:0};
    topic.sourceIds.push(link.source_id);topic.facts+=link.facts;topics.set(link.entity_key,topic);
  }
  const ordered=[...topics.values()].sort((a,b)=>b.sourceIds.length-a.sourceIds.length||b.facts-a.facts||a.name.localeCompare(b.name));
  return {sources,topics:ordered.slice(0,300),topicCount:ordered.length,unavailable,
    limited:memory.store.status().sources>rows.length||ordered.length>300,
    totals:{sources:sources.length,documents:sources.filter(s=>s.type==='document').length,meetings:sources.filter(s=>s.type==='meeting').length,
      facts:sources.reduce((n,s)=>n+s.facts,0),knowledgeUnits:sources.reduce((n,s)=>n+s.knowledgeUnits,0)},
    pending:memory.store.status().pending};
}
