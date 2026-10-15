import React, {useEffect,useState} from 'react';
import {api,MemoryCitation,DocumentInfo,DocumentDetail,MemoryInsights} from '../services/api';
const states:Record<string,string>={queued:'等待处理',interpreting:'逐页解读',organizing:'整理知识',ready:'已进入记忆',open:'待跟进',completed:'有完成证据',resolved:'有解决证据',cancelled:'有取消证据',uncertain:'依据不完整',conflict:'说法有冲突'};
export function MemoryHub({open,onClose,source,onOpenMemory}:{open:boolean;onClose:()=>void;source?:MemoryCitation|null;onOpenMemory:(c:MemoryCitation)=>Promise<void>}) {
  const [docs,setDocs]=useState<DocumentInfo[]>([]),[detail,setDetail]=useState<DocumentDetail|null>(null),[page,setPage]=useState(1);
  const [insights,setInsights]=useState<MemoryInsights|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=async()=>{const [d,i]=await Promise.all([api.documents(),api.memoryInsights()]);setDocs(d);setInsights(i);};
  useEffect(()=>{if(!open)return;let live=true;const load=()=>refresh().catch(e=>{if(live)setError(e.message);});void load();const timer=setInterval(load,5000);return()=>{live=false;clearInterval(timer);};},[open]);
  useEffect(()=>{if(open&&!source)setDetail(null);if(open&&source?.sourceType==='document') {api.document(source.meetingId).then(setDetail).catch(e=>setError(e.message));setPage(source.pages?.[0]||1);}},[open,source]);
  const upload=async(files:FileList|null,replaces?:string)=>{if(!files?.length)return;setBusy(true);setError('');try {const failures:string[]=[];for(const file of Array.from(files)){try{await api.uploadDocument(file,replaces);}catch(e:any){failures.push(`${file.name}：${e.message}`);}}await refresh();setError(failures.join('；'));}catch(e:any){setError(e.message);}finally{setBusy(false);}};
  const show=async(id:string)=>{try{setDetail(await api.document(id));setPage(1);}catch(e:any){setError(e.message);}};
  if(!open)return null;
  const current=detail?.pages.find(p=>p.number===page);
  return <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" role="dialog" aria-modal="true" aria-label="记忆与资料">
    <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-6xl h-[88vh] flex flex-col text-slate-200 shadow-xl">
      <div className="flex items-center justify-between p-4 border-b border-slate-700"><h2 className="font-semibold">记忆与资料</h2><button onClick={onClose} aria-label="关闭记忆与资料">关闭</button></div>
      {error&&<p role="alert" className="p-3 text-amber-300 text-sm">{error}</p>}
      <div className="flex flex-1 min-h-0">
        <div className="w-80 border-r border-slate-700 p-4 overflow-auto shrink-0" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(!busy)void upload(e.dataTransfer.files);}}>
          <label className="block p-4 border border-dashed border-cyan-700 rounded cursor-pointer text-sm text-cyan-300">{busy?'正在上传…':'上传或拖入文档（可多选）'}<input type="file" multiple disabled={busy} className="block mt-2 w-full text-xs" accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg,.webp" onChange={e=>{void upload(e.target.files);e.target.value='';}}/></label>
          <p className="text-xs text-slate-400 my-3">上传后自动解读和整理。PDF/PPT 全页看图完成后才入库。每份最多 40MB、200 页；PPT/DOC 需要 LibreOffice。解读使用已配置的大模型。</p>
          {docs.map(d=><div key={d.id} className="border-t border-slate-700 py-3 text-xs"><button onClick={()=>void show(d.id)} className="text-left text-sm text-cyan-200 break-all">{d.name}</button><p className="mt-1">{states[d.status]||d.status} {d.pageCount>0&&`· ${d.interpreted}/${d.pageCount} 页`}</p>{d.error&&<p className="text-amber-300 mt-1">{d.error}</p>}<div className="flex gap-3 mt-2"><button onClick={()=>{void api.retryDocument(d.id).then(refresh).catch(e=>setError(e.message));}}>重试</button><button onClick={()=>{void api.deleteDocument(d.id).then(()=>{if(detail?.id===d.id)setDetail(null);return refresh();}).catch(e=>setError(e.message));}}>移出记忆</button>{d.status==='ready'&&<label className="cursor-pointer">更新版本<input type="file" className="hidden" onChange={e=>{void upload(e.target.files,d.id);e.target.value='';}}/></label>}</div></div>)}
          {!docs.length&&<p className="text-sm text-slate-400 mt-4">还没有上传资料。录音记忆仍会自动整理。</p>}
        </div>
        <div className="flex-1 overflow-auto p-5 select-text">
          {detail?<><button className="text-cyan-300 text-sm mb-3" onClick={()=>setDetail(null)}>← 自动跟进</button><h3 className="font-bold">{detail.name}</h3><p className="text-xs text-slate-400 mt-1">材料日期：{detail.materialDate||'未知'} · 上传于 {new Date(detail.uploadedAt).toLocaleString()} · 版本 {detail.digest.slice(0,12)}</p><div className="flex gap-4 text-sm text-cyan-300 my-4"><a href={api.documentFile(detail.id,'original')}>下载原文件</a>{detail.status==='ready'&&<a href={api.documentFile(detail.id,'knowledge')}>下载整理后的知识</a>}<button onClick={()=>void show(detail.id)}>刷新进度</button></div>
            {detail.pages.length>0&&<select aria-label="来源页" className="bg-slate-800 p-2 mb-3" value={page} onChange={e=>setPage(Number(e.target.value))}>{detail.pages.map(p=><option key={p.number} value={p.number}>{p.label}</option>)}</select>}
            {current?.image&&<img src={api.documentFile(detail.id,'page',page)} alt={`${detail.name} ${current.label}`} className="w-full bg-white rounded"/>}
            {current&&<><h4 className="mt-4 text-sm font-semibold">来源文字</h4><pre className="whitespace-pre-wrap text-sm mt-2">{current.text||'扫描页或图片，请核对上方原页'}</pre>{current.ledger&&<div className="mt-4 text-sm"><h4 className="text-cyan-300">页面视觉解读（模型识别，请结合原页核对）</h4><p className="whitespace-pre-wrap mt-2">{current.ledger.facts}</p><p className="whitespace-pre-wrap mt-2">{current.ledger.charts}</p></div>}</>}
            {detail.knowledge.flatMap(g=>g.units).filter(u=>u.pages.includes(page)).map((u,i)=><div className="mt-4 border-t border-slate-700 pt-3 text-sm" key={i}><h4 className="font-semibold">{u.question}</h4><p className="whitespace-pre-wrap mt-2">{u.answer}</p><p className="text-xs text-slate-400 mt-2">{u.basis==='fact'?'材料事实（模型整理）':u.basis==='synthesis'?'模型归纳':'解释'} · 来源页 {u.pages.join('、')}</p></div>)}
          </>:<><h3 className="font-bold mb-2">自动跟进</h3><p className="text-xs text-slate-400 mb-4">仅依据可读取的有效来源。无需手动建库或勾选完成；新证据会自动更新。{insights?.pending?`仍有 ${insights.pending} 批资料等待整理。`:''}</p>
            {insights?.followups.map(t=><div key={t.id} className="border border-slate-700 rounded p-3 mb-3 text-sm"><p className="text-cyan-200">{t.scope} · {t.project} · {t.item}</p><p className="my-2">{t.type==='question'?'问题':'承诺 / 待办'} · {states[t.status]}{t.overdue?' · 已过期限，尚无完成证据':''}</p><p className="text-xs text-slate-400">责任人：{t.owners.join('、')||'未明确'} · 期限：{t.dueDate||'未明确'}</p>{t.history.map(h=><div key={h.id} className="mt-2"><p className="whitespace-pre-wrap">“{h.quote}”</p><button className="text-xs text-cyan-300" onClick={()=>{const c=insights.citations.find(c=>c.chunkId===h.chunkId);if(c)void onOpenMemory(c).catch(e=>setError(e.message));}}>核对来源 · {h.observedAt||'时间未知'}</button></div>)}</div>)}
            {insights?.changes.map((c,i)=><div key={i} className="border border-slate-700 rounded p-3 mb-3 text-sm"><p>{c.scope} · {c.project} · {c.aspect} · {c.status==='conflict'?'待核实冲突':'有明确变更'}</p>{c.history.map(h=><div key={h.id} className="mt-2"><p>“{h.quote}”</p><button className="text-cyan-300 text-xs" onClick={()=>{const source=insights.citations.find(c=>c.chunkId===h.chunkId);if(source)void onOpenMemory(source).catch(e=>setError(e.message));}}>核对变更依据</button></div>)}</div>)}
            {!insights?.followups.length&&!insights?.changes.length&&<p className="text-sm text-slate-400">暂未提取到有充分证据的跟进事项或变化。已有原文仍可直接提问。</p>}
          </>}
        </div>
      </div>
    </div>
  </div>;
}
