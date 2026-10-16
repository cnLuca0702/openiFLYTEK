import {useEffect,useState} from 'react';
import {ArrowLeft,BookOpen,Download,FileText,Loader2} from 'lucide-react';
import {api,DocumentDetail,MemoryCitation} from '../services/api';
import {KnowledgePanorama} from './KnowledgePanorama';
const states:Record<string,string>={queued:'等待处理',interpreting:'逐页解读',organizing:'整理知识',ready:'已进入记忆'};
const basis:Record<string,string>={fact:'材料事实（模型整理）',interpretation:'解释',synthesis:'模型归纳'};

type Selection={id:string;page?:number;request:number};
export function MemoryWorkspace({selection,onSelect,onOverview,onOpenMemory}:{selection:Selection|null;onSelect:(id:string)=>void;onOverview:()=>void;onOpenMemory:(c:MemoryCitation)=>Promise<void>}) {
  return <main aria-label="记忆与资料工作台" className="flex flex-col flex-1 min-h-0 min-w-0 bg-slate-950/30 select-text">
    {selection?<DocumentKnowledge key={selection.id} selection={selection} onOverview={onOverview}/>:<KnowledgePanorama onSelect={onSelect} onOpenMemory={onOpenMemory}/>}
  </main>;
}
function DocumentKnowledge({selection,onOverview}:{selection:Selection;onOverview:()=>void}) {
  const [detail,setDetail]=useState<DocumentDetail|null>(null),[error,setError]=useState('');
  const [page,setPage]=useState(selection.page||1),[view,setView]=useState<'knowledge'|'source'>(selection.page?'source':'knowledge');
  const [query,setQuery]=useState('');
  useEffect(()=>{setPage(selection.page||1);setView(selection.page?'source':'knowledge');},[selection.request,selection.page]);
  useEffect(()=>{
    let live=true,busy=false;
    const load=async()=>{if(busy)return;busy=true;try {const next=await api.document(selection.id);if(live){setDetail(next);setError('');setPage(p=>next.pages.some(x=>x.number===p)?p:next.pages[0]?.number||1);}}catch(e:any){if(live){setError(e.message);setDetail(null);}}finally{busy=false;}};
    void load();const timer=setInterval(load,5000);return()=>{live=false;clearInterval(timer);};
  },[selection.id]);
  const current=detail?.pages.find(p=>p.number===page);
  const units=(detail?.knowledge.flatMap(g=>g.units)||[]).filter(u=>!query.trim()||`${u.question} ${u.answer}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <>
    <header className="shrink-0 p-5 border-b border-viaim-border space-y-3">
      <button onClick={onOverview} className="text-xs text-cyan-300 flex gap-1 items-center"><ArrowLeft size={14}/>知识全景</button>
      <h1 className="font-semibold text-lg break-words">{detail?.name||'资料知识'}</h1>
      {detail&&<><p className="text-xs text-viaim-textDim">{states[detail.status]||detail.status} · {detail.interpreted}/{detail.pageCount} 页／段落组 · 材料日期 {detail.materialDate||'未知'}</p>
      <div className="flex flex-wrap gap-3 text-xs">
        <a href={api.documentFile(detail.id,'original')} className="text-cyan-300 flex gap-1 items-center"><Download size={13}/>原文件</a>
        {detail.status==='ready'&&<a href={api.documentFile(detail.id,'knowledge')} className="text-cyan-300">下载整理后的知识</a>}
      </div></>}
      <div className="flex gap-2" role="tablist" aria-label="资料阅读方式">{(['knowledge','source'] as const).map(v=><button key={v} role="tab" aria-selected={view===v} onClick={()=>setView(v)} className={`rounded-lg px-3 py-2 text-xs flex gap-1.5 items-center ${view===v?'bg-cyan-500/15 text-viaim-primary':'text-viaim-textDim hover:bg-slate-800'}`}>{v==='knowledge'?<BookOpen size={14}/>:<FileText size={14}/>} {v==='knowledge'?'知识内容':'原文与页图'}</button>)}</div>
    </header>
    <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 custom-scrollbar" role="tabpanel" aria-label={view==='knowledge'?'知识内容':'原文与页图'}>
      {error&&<p role="alert" className="text-sm text-amber-300">{error}。可返回知识全景选择其他资料。</p>}
      {!detail&&!error&&<p className="text-sm text-viaim-textDim flex gap-2"><Loader2 size={16} className="animate-spin"/>正在读取资料…</p>}
      {detail?.error&&<p role="status" className="text-sm text-amber-300">{detail.error}</p>}
      {detail&&view==='knowledge'&&<>
        {detail.status!=='ready'&&<p className="rounded-lg bg-indigo-500/10 p-3 text-xs text-viaim-primary">资料正在自动处理，知识内容会随进度更新。全部整理完成后才会进入记忆。</p>}
        <input aria-label="搜索本资料知识" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索这份资料中的知识…" className="w-full rounded-lg border border-viaim-border bg-slate-900 p-2.5 text-sm"/>
        {!query&&detail.knowledge.map((g,i)=><p key={i} className="text-sm leading-relaxed text-viaim-textDim">{g.overview}</p>)}
        <p className="text-xs text-viaim-textDim">{units.length} 条知识 · 模型整理内容请结合来源核对</p>
        {units.map((u,i)=><article key={i} className="p-4 border border-viaim-border rounded-xl bg-slate-900/50 space-y-3">
          <h2 className="text-sm font-semibold text-viaim-textMain">{u.question}</h2><p className="text-sm leading-7 whitespace-pre-wrap break-words">{u.answer}</p>
          <div className="flex gap-2 flex-wrap items-center text-xs"><span className="text-viaim-textDim">{basis[u.basis]||u.basis}</span>{u.pages.map(n=><button key={n} className="text-cyan-300 rounded bg-cyan-500/10 px-2 py-1" onClick={()=>{setPage(n);setView('source');}}>核对来源 · {detail.pages.find(p=>p.number===n)?.label||`第 ${n} 页`}</button>)}</div>
        </article>)}
        {!units.length&&<p className="py-8 text-center text-sm text-viaim-textDim">{query?'没有匹配的知识内容':detail.status==='ready'?'暂无整理出的知识单元，可查看原文':'知识整理尚未完成，无需重复上传'}</p>}
      </>}
      {detail&&view==='source'&&<>
        {detail.pages.length>0?<label className="block text-xs text-viaim-textDim">来源位置<select aria-label="来源位置" className="block w-full mt-2 bg-slate-800 p-2 rounded text-viaim-textMain" value={page} onChange={e=>setPage(Number(e.target.value))}>{detail.pages.map(p=><option key={p.number} value={p.number}>{p.label}</option>)}</select></label>:<p className="text-sm text-viaim-textDim">原文尚在解析中。</p>}
        {current?.image&&<img src={api.documentFile(detail.id,'page',page)} alt={`${detail.name} ${current.label}`} className="w-full bg-white rounded-lg"/>}
        {current&&<section><h2 className="text-sm font-semibold mb-2">来源文字</h2><pre className="text-sm leading-7 whitespace-pre-wrap break-words font-sans">{current.text||'本页无可提取文字，请核对页图。'}</pre></section>}
        {current?.ledger&&<section className="border-t border-viaim-border pt-4"><h2 className="text-sm text-cyan-300 mb-2">页面视觉解读</h2><p className="text-xs text-viaim-textDim mb-3">以下为模型识别，可能存在误读，请结合原页核对。</p><p className="text-sm leading-7 whitespace-pre-wrap">{current.ledger.facts}</p><p className="text-sm leading-7 whitespace-pre-wrap mt-3">{current.ledger.charts}</p></section>}
      </>}
    </div>
  </>;
}
