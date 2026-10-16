import {useEffect,useState} from 'react';
import {BookOpen,FileText,Mic,Network,Search} from 'lucide-react';
import {api,DocumentInfo,MemoryCitation,MemoryPanorama,MemoryInsights} from '../services/api';
const typeNames:Record<string,string>={concept:'概念',technology:'技术',product:'产品',project:'项目',organization:'单位',person:'人物'};

export function KnowledgePanorama({onSelect,onOpenMemory}:{onSelect:(id:string)=>void;onOpenMemory:(c:MemoryCitation)=>Promise<void>}) {
  const [data,setData]=useState<MemoryPanorama|null>(null),[docs,setDocs]=useState<DocumentInfo[]>([]),[error,setError]=useState('');
  const [insights,setInsights]=useState<MemoryInsights|null>(null);
  const [topicId,setTopicId]=useState<string|null>(null),[query,setQuery]=useState('');
  useEffect(()=>{let live=true,busy=false;const load=async()=>{if(busy)return;busy=true;try {const [next,files,tracking]=await Promise.all([api.memoryPanorama(),api.documents(),api.memoryInsights()]);if(live){setData(next);setDocs(files);setInsights(tracking);setError('');setTopicId(id=>next.topics.some(t=>t.id===id)?id:null);}}catch(e:any){if(live)setError(e.message);}finally{busy=false;}};void load();const timer=setInterval(load,10000);return()=>{live=false;clearInterval(timer);};},[]);
  const selected=data?.topics.find(t=>t.id===topicId);
  const q=query.trim().toLowerCase();
  const topics=(data?.topics||[]).filter(t=>!q||`${t.name} ${t.scope}`.toLowerCase().includes(q));
  const sources=(data?.sources||[]).filter(s=>(!selected||selected.sourceIds.includes(s.id))&&(!q||s.title.toLowerCase().includes(q)||topics.some(t=>t.sourceIds.includes(s.id))));
  const pendingDocs=docs.filter(d=>d.status!=='ready');
  const openSource=(s:MemoryPanorama['sources'][number])=>{if(s.type==='document')onSelect(s.id);else void onOpenMemory(s.citation).catch(e=>setError(e.message));};
  const nodes=topics.length?topics.slice(0,8).map(t=>({id:t.id,name:t.name,subtitle:`${typeNames[t.type]||t.type} · ${t.sourceIds.length} 个来源`,scope:t.scope,action:()=>setTopicId(t.id===topicId?null:t.id),active:t.id===topicId})):sources.slice(0,8).map(s=>({id:s.id,name:s.title,subtitle:s.type==='document'?'资料':'会议',scope:'',action:()=>openSource(s),active:false}));
  return <>
    <header className="p-5 border-b border-viaim-border shrink-0"><div className="flex items-center gap-2"><Network className="text-cyan-300" size={20}/><h1 className="text-lg font-semibold">知识全景</h1></div><p className="text-xs text-viaim-textDim mt-2">从资料与会议中自动积累 · 点击主题探索来源，点击资料阅读知识</p></header>
    <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 custom-scrollbar">
      {error&&<p role="alert" className="text-xs text-amber-300">{error}{data?'，当前显示上次成功加载的全景。':''}</p>}
      {!data&&!error&&<p className="text-sm text-viaim-textDim">正在汇集已有知识…</p>}
      {data&&<>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-2">{[[data.totals.documents,'资料'],[data.totals.meetings,'会议'],[data.totals.knowledgeUnits,'知识单元'],[data.topicCount,'主题']].map(([n,label])=><div key={label} className="rounded-xl border border-viaim-border bg-slate-900/60 p-3"><p className="text-xl font-semibold text-viaim-textMain">{n}</p><p className="text-xs text-viaim-textDim mt-1">{label}</p></div>)}</div>
        <section className="rounded-2xl border border-cyan-800/40 bg-gradient-to-b from-cyan-950/20 to-slate-950/30 overflow-hidden">
          <div className="flex justify-between p-4 pb-0 text-xs"><span className="text-viaim-primary">{topics.length?'主题分布':'来源分布'}</span><span className="text-viaim-textDim">{nodes.length?`展示 ${nodes.length} 个节点`:''}</span></div>
          {nodes.length?<svg viewBox="0 0 640 300" className="w-full" aria-label="知识主题与来源分布图">
            {nodes.map((n,i)=>{const angle=(i/nodes.length)*Math.PI*2-Math.PI/2;const x=320+Math.cos(angle)*218,y=150+Math.sin(angle)*100;return <g key={n.id}>
              <path d={`M320 150 Q${320+(x-320)*.3} ${y} ${x} ${y}`} fill="none" stroke={n.active?'#4F6BEB':'#C3CAD5'} strokeWidth={n.active?2:1}/>
              <g role="button" tabIndex={0} aria-label={`${n.scope} ${n.name}，${n.subtitle}`} aria-pressed={n.active} onClick={n.action} onKeyDown={e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();n.action();}}} className="cursor-pointer outline-none focus:stroke-cyan-200">
                <title>{n.scope} {n.name} · {n.subtitle}</title><rect x={x-76} y={y-23} width="152" height="46" rx="12" fill={n.active?'#EEF3FF':'#FFFFFF'} stroke={n.active?'#4F6BEB':'#DAE0E8'}/>
                <text x={x} y={y-3} textAnchor="middle" fill="#1F2937" fontSize="12">{n.name.length>12?n.name.slice(0,12)+'…':n.name}</text><text x={x} y={y+13} textAnchor="middle" fill="#5A6473" fontSize="10">{n.subtitle}</text>
              </g>
            </g>;})}
            <circle cx="320" cy="150" r="43" fill="#EEF3FF" stroke="#4F6BEB" strokeOpacity=".5"/><text x="320" y="147" textAnchor="middle" fill="#1F2937" fontSize="15">已有知识</text><text x="320" y="165" textAnchor="middle" fill="#4F6BEB" fontSize="11">{data.totals.sources} 个来源</text>
          </svg>:<div className="p-10 text-center text-viaim-textDim"><BookOpen className="mx-auto mb-3 opacity-50"/><p className="text-sm">知识正在这里积累</p><p className="text-xs mt-2">从左栏上传资料，或录制、导入会议。处理完成后自动汇入全景。</p></div>}
          <p className="px-4 pb-4 text-[11px] text-viaim-textDim">连线表示主题归入知识库，来源关联以原文实体为依据，不代表因果关系或任务完成。{data.pending>0?`还有 ${data.pending} 批事实待整理。`:''}</p>
        </section>
        {(data.limited||data.unavailable>0)&&<p className="text-xs text-amber-300">{data.limited?'本视图最多展示 500 个来源、300 个主题，统计仅覆盖当前展示范围。':''}{data.unavailable>0?` ${data.unavailable} 个来源暂不可读取，未纳入当前视图。`:''}</p>}
        <div className="relative"><Search size={15} className="absolute left-3 top-3 text-viaim-textDim"/><input aria-label="搜索全景主题或来源" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索主题、项目或来源…" className="w-full bg-slate-900 border border-viaim-border rounded-lg py-2.5 pl-9 pr-3 text-xs"/></div>
        {data.topics.length>0&&<label className="flex gap-2 items-center text-xs text-viaim-textDim">主题<select aria-label="筛选知识主题" value={topicId||''} onChange={e=>setTopicId(e.target.value||null)} className="min-w-0 flex-1 bg-slate-800 rounded p-2"><option value="">全部主题</option>{data.topics.map(t=><option key={t.id} value={t.id}>{t.scope?`${t.scope} · `:''}{t.name}（{t.sourceIds.length} 个来源）</option>)}</select></label>}
        <section className="space-y-3"><h2 className="text-sm font-semibold">{selected?`${selected.scope} ${selected.name} · 相关来源`:'全部知识来源'} <span className="text-viaim-textDim font-normal">{sources.length}</span></h2>
          {sources.map(s=><button key={s.id} onClick={()=>openSource(s)} className="w-full text-left p-4 rounded-xl border border-viaim-border hover:border-cyan-700 bg-slate-900/40 flex gap-3 transition-colors">{s.type==='document'?<FileText className="shrink-0 text-cyan-300" size={18}/>:<Mic className="shrink-0 text-indigo-300" size={18}/>}<div className="min-w-0"><h3 className="text-sm break-words">{s.title}</h3><p className="text-xs text-viaim-textDim mt-1">{s.type==='document'?`${s.knowledgeUnits} 条知识`:'会议记忆'} · {s.facts} 条提取事实 · {s.date?s.date.slice(0,10):'来源日期未知'}</p></div></button>)}
          {!sources.length&&data.totals.sources>0&&<p className="text-xs text-viaim-textDim">没有匹配的来源，试试其他关键词或选择全部主题。</p>}
        </section>
        {!!insights&&(insights.followups.length>0||insights.changes.length>0)&&<section className="border-t border-viaim-border pt-4 space-y-3"><h2 className="text-sm font-semibold">自动跟进与变化</h2>
          {insights.followups.map(t=><details key={t.id} className="p-3 rounded-lg border border-viaim-border text-xs"><summary className="cursor-pointer text-viaim-textMain">{t.scope} · {t.project} · {t.item} · {({open:'待跟进',completed:'有完成证据',resolved:'有答复证据',cancelled:'已取消',conflict:'有冲突',uncertain:'依据不完整'} as Record<string,string>)[t.status]||t.status}</summary><p className="mt-2 text-viaim-textDim">责任人 {t.owners.join('、')||'未明确'} · {t.dueDate||'期限未明确'}{t.overdue?' · 已过期限，尚无完成证据':''}</p>{t.history.map(h=><p key={h.id} className="mt-3 leading-6">{h.quote} <button className="text-cyan-300" onClick={()=>{const c=insights.citations.find(c=>c.chunkId===h.chunkId);if(c)void onOpenMemory(c).catch(e=>setError(e.message));}}>核对来源</button></p>)}</details>)}
          {insights.changes.map((c,i)=><details key={i} className="p-3 rounded-lg border border-viaim-border text-xs"><summary className="cursor-pointer text-viaim-amber">{c.scope} · {c.project} · {c.aspect} · {c.status==='conflict'?'待核实冲突':'有明确变更'}</summary>{c.history.map(h=><p key={h.id} className="mt-3 leading-6">{h.quote} <button className="text-cyan-300" onClick={()=>{const source=insights.citations.find(s=>s.chunkId===h.chunkId);if(source)void onOpenMemory(source).catch(e=>setError(e.message));}}>核对依据</button></p>)}</details>)}
        </section>}
        {pendingDocs.length>0&&<section className="border-t border-viaim-border pt-4 space-y-2"><h2 className="text-sm font-semibold">尚未进入记忆 · {pendingDocs.length}</h2>{pendingDocs.map(d=><button key={d.id} onClick={()=>onSelect(d.id)} className="block text-left w-full text-xs p-3 rounded-lg bg-slate-900/50 text-viaim-textDim"><span className="text-viaim-textMain break-words">{d.name}</span> · {d.error?'处理待重试':d.status==='queued'?'等待处理':d.status==='interpreting'?'逐页解读':'整理知识'}</button>)}</section>}
      </>}
    </div>
  </>;
}
