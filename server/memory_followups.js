import { normalize, resolveDate } from './memory_graph.js';
// Links require literal shared organization/project/item identity. No fuzzy person matching.
export function validateFollowup(fact) {
  const f=fact.followup, q=String(fact.quote||'');
  if(!f || fact.kind==='proposal' || /建议|如果|假如|可能/.test(q) || !['task','question'].includes(f.type))return null;
  for(const key of ['scope','project','item'])if(typeof f[key]!=='string'||f[key].length<2||f[key].length>150||!q.includes(f[key]))return null;
  if(!['open','completed','resolved','cancelled'].includes(f.event))return null;
  if(f.event!=='open' && /尚未|未完成|没有完成|未解决|没有解决|未确认|没有确认|否认|建议|计划|预计|将要|如果|可能|待确认/.test(q))return null;
  if(f.event==='completed'&&!/已完成|已经完成|已提交|已交付|已验收/.test(q))return null;
  if(f.event==='resolved'&&!/已解决|已经解决|已确认|结论是|答复是/.test(q))return null;
  if(f.event==='cancelled'&&!/取消|撤销|不再需要/.test(q))return null;
  if(f.type==='task'&&f.event==='resolved'||f.type==='question'&&f.event==='completed')return null;
  const owner=typeof f.owner==='string'&&q.includes(f.owner)?f.owner:'';
  const due=typeof f.due==='string'&&q.includes(f.due)?f.due:'';
  return {type:f.type,scope:f.scope,project:f.project,item:f.item,event:f.event,owner,due};
}
export function buildFollowups(facts,now=Date.now()) {
  const groups=new Map();
  for(const fact of facts) {
    const f=fact.followup; if(!f)continue;
    const key=[f.type,f.scope,f.project,f.item].map(normalize).join('|');
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push({...f,id:fact.id,chunkId:fact.chunk_id,sourceId:fact.source_id,quote:fact.quote,observedAt:fact.occurred_at,time:Date.parse(fact.occurred_at),dueDate:resolveDate(f.due,fact.occurred_at)});
  }
  return [...groups.entries()].map(([id,history])=> {
    history.sort((a,b)=>(a.time||0)-(b.time||0)||a.id.localeCompare(b.id));
    const latest=history.at(-1), opens=history.filter(h=>h.event==='open'), terminal=history.filter(h=>h.event!=='open');
    let status='open';
    if(history.some(h=>!Number.isFinite(h.time)||h.time>now))status='uncertain';
    else if(terminal.length) {
      // A later open is not proof of reopening; contradictory events require explanation.
      const lastTerminal=terminal.at(-1);
      status=opens.some(h=>h.time>=lastTerminal.time)||new Set(terminal.map(h=>h.event)).size>1?'conflict':lastTerminal.event;
      if(!opens.length)status='uncertain';
    }
    const dueDates=[...new Set(opens.map(h=>h.dueDate).filter(Boolean))];
    const owners=[...new Set(opens.map(h=>h.owner).filter(Boolean))];
    if(status==='open'&&(dueDates.length>1||owners.length>1))status='conflict';
    const dueDate=dueDates.length===1?dueDates[0]:null;
    return {id,type:latest.type,scope:latest.scope,project:latest.project,item:latest.item,status,owners,dueDate,
      overdue:status==='open'&&!!dueDate&&Date.parse(dueDate+'T23:59:59+08:00')<now,history};
  });
}
