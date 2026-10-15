import {useEffect,useState} from 'react';
import {api,MemoryCitation,MemoryInsights} from '../services/api';
export function AutomaticFollowup({meetingId,onOpen}:{meetingId:string;onOpen:(c:MemoryCitation)=>Promise<void>}) {
  const [data,setData]=useState<MemoryInsights|null>(null),[error,setError]=useState('');
  useEffect(()=>{let active=true;setData(null);setError('');const load=()=>api.memoryInsights(meetingId).then(d=>{if(active)setData(d);}).catch(()=>{});void load();const timer=setInterval(load,60000);return()=>{active=false;clearInterval(timer);};},[meetingId]);
  if(!data||(!data.followups.length&&!data.changes.length))return null;
  const source=(id:number)=>{const c=data.citations.find(c=>c.chunkId===id);if(c)void onOpen(c).catch(e=>setError(e.message));};
  return <div className="p-3.5 rounded-xl bg-viaim-card/80 border border-viaim-border space-y-2 text-xs">
    <h4 className="font-bold text-cyan-300">本次会议的变化与跟进</h4>
    <p className="text-[10px] text-viaim-textDim">跨来源自动核对，独立于本次纪要和待办。{data.pending>0?'仍有资料等待整理。':''}</p>
    {data.followups.slice(0,5).map(t=><details key={t.id}><summary className="cursor-pointer">{t.item} · {({open:'待跟进',completed:'有完成证据',resolved:'有答复证据',cancelled:'已取消',conflict:'有冲突',uncertain:'依据不完整'} as Record<string,string>)[t.status]}{t.overdue?'（已过期限，尚无完成证据）':''}</summary><p className="mt-1">{t.owners.join('、')||'责任人未明确'} · {t.dueDate||'期限未明确'}</p>{t.history.map(h=><p key={h.id} className="mt-2 select-text">{h.quote} <button className="text-cyan-300" onClick={()=>source(h.chunkId)}>来源</button></p>)}</details>)}
    {data.changes.slice(0,5).map((c,i)=><details key={i}><summary className="cursor-pointer">{c.project} · {c.aspect} · {c.status==='conflict'?'存在冲突':'有明确变更'}</summary>{c.history.map(h=><p key={h.id} className="mt-2 select-text">{h.quote} <button className="text-cyan-300" onClick={()=>source(h.chunkId)}>来源</button></p>)}</details>)}
    {error&&<p className="text-amber-300">{error}</p>}
  </div>;
}
