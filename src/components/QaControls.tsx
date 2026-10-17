import React, {useEffect,useState} from 'react';
import {QaPolicy,QaSource,QaScope,scopeLabels,getQaSources} from '../services/qa';
export function QaControls({value,onChange,currentSource,disabled=false,pickerRequest=0}:{value:QaPolicy;onChange:(p:QaPolicy)=>void;currentSource?:QaSource|null;disabled?:boolean;pickerRequest?:number}) {
  const [sources,setSources]=useState<QaSource[]>([]),[error,setError]=useState(''),[query,setQuery]=useState(''),[open,setOpen]=useState(false);
  const load=()=>getQaSources().then(r=>{setSources(r.sources);setError(r.warnings.join('；'));}).catch(e=>setError(e.message));
  useEffect(()=>{void load();},[]);
  useEffect(()=>{if(pickerRequest){setOpen(true);void load();}},[pickerRequest]);
  const changeScope=(scope:QaScope)=>{onChange({...value,scope,sourceIds:scope==='selected'?value.sourceIds:[]});if(scope==='selected'){setOpen(true);void load();}else setOpen(false);};
  return <div className="space-y-2 text-xs">
    <div className="flex flex-wrap items-center gap-2">
      <select aria-label="回答资料范围" disabled={disabled} value={value.scope} onChange={e=>changeScope(e.target.value as QaScope)} className="max-w-full bg-viaim-card border border-viaim-border rounded-lg p-1.5">
        {Object.entries(scopeLabels).map(([id,label])=><option key={id} value={id}>{label}</option>)}
      </select>
      <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={value.allowModelKnowledge} onChange={e=>onChange({...value,allowModelKnowledge:e.target.checked})}/>模型知识</label>
      <label className="flex items-center gap-1"><input type="checkbox" disabled={disabled} checked={value.webResearch} onChange={e=>onChange({...value,webResearch:e.target.checked})}/>联网研究</label>
    </div>
    {value.scope==='current'&&<p className="text-viaim-textDim">当前资料：{currentSource?.title||'请先在中栏选择一项资料'}</p>}
    {value.scope==='selected'&&<>
      <button disabled={disabled} className="text-viaim-primary" onClick={()=>{setOpen(!open);void load();}}>已选 {value.sourceIds.length} 项 · {open?'收起':'选择会议与文档'}</button>
      <div className="flex flex-wrap gap-1">{value.sourceIds.slice(0,3).map(id=><button disabled={disabled} key={id} className="max-w-full truncate px-2 py-1 rounded bg-viaim-primary/10" title="移除资料" onClick={()=>onChange({...value,sourceIds:value.sourceIds.filter(x=>x!==id)})}>{sources.find(s=>s.id===id)?.title||'资料不可用'} ×</button>)}{value.sourceIds.length>3&&<span>另 {value.sourceIds.length-3} 项</span>}</div>
    </>}
    {open&&value.scope==='selected'&&<div className="p-2 rounded-lg border border-viaim-border space-y-2">
      <input aria-label="搜索可选资料" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索会议或文档" className="w-full p-1.5 bg-viaim-bg rounded border border-viaim-border"/>
      <div className="max-h-40 overflow-y-auto">{sources.filter(s=>s.title.toLowerCase().includes(query.toLowerCase())).map(s=><label key={s.id} className="flex items-start gap-2 py-1.5"><input type="checkbox" disabled={disabled||(!value.sourceIds.includes(s.id)&&value.sourceIds.length>=50)} checked={value.sourceIds.includes(s.id)} onChange={e=>onChange({...value,scope:'selected',sourceIds:e.target.checked?[...value.sourceIds,s.id]:value.sourceIds.filter(id=>id!==s.id)})}/><span>{s.type==='document'?'文档':'会议'} · {s.title}</span></label>)}{!sources.length&&<p>暂无可用资料，文档处理完成后可选。</p>}</div>
      {error&&<p role="alert" className="text-amber-600">{error}</p>}
    </div>}
  </div>;
}
