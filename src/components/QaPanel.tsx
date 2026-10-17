import React,{useEffect,useRef,useState} from 'react';
import {Send,Square,Plus,Settings} from 'lucide-react';
import {api,MemoryCitation} from '../services/api';
import {askQuestion,defaultQaPolicy,getQaConfig,getQaSources,saveQaConfig,QaPolicy,QaResult,QaSource,scopeLabels} from '../services/qa';
import {QaControls} from './QaControls';
import {MemoryState} from './MemoryState';
type Message={role:'user'|'assistant';content:string;scope?:string;result?:QaResult};
export function QaPanel({currentSource:requestedSource,onOpenMemory,onOpenSettings}:{currentSource:QaSource|null;onOpenMemory:(c:MemoryCitation)=>Promise<void>;onOpenSettings:()=>void}){
  const [resolvedSource,setResolvedSource]=useState<QaSource|null>(null);
  const currentSource=requestedSource?.type==='document' ? (resolvedSource?.id===requestedSource.id?resolvedSource:null) : requestedSource;
  useEffect(()=>{
    if(requestedSource?.type!=='document')return;
    let active=true;
    const load=()=>getQaSources().then(r=>{if(active)setResolvedSource(r.sources.find(s=>s.id===requestedSource.id)||null);}).catch(()=>{if(active)setResolvedSource(null);});
    void load();const timer=setInterval(load,5000);
    return()=>{active=false;clearInterval(timer);};
  },[requestedSource?.id,requestedSource?.type]);

  const [policy,setPolicy]=useState<QaPolicy>(defaultQaPolicy),[ready,setReady]=useState(false),[input,setInput]=useState(''),[searchQuery,setSearchQuery]=useState('');
  const [messages,setMessages]=useState<Message[]>([]),[busy,setBusy]=useState(false),[progress,setProgress]=useState(''),[notice,setNotice]=useState(''),[picker,setPicker]=useState(0);
  const [models,setModels]=useState<Array<{key:string;providerId:string;model:string;label:string}>>([]),[modelKey,setModelKey]=useState('');
  const controller=useRef<AbortController|null>(null),run=useRef(0),body=useRef<HTMLDivElement>(null);
  const refresh=async()=>{
    setReady(false);setNotice('');
    try{const c=await getQaConfig();setPolicy(c.defaults);setReady(true);}catch(e:any){setNotice(e.message||'加载问答设置失败');}
    try{const [config,providers]=await Promise.all([api.getLlmConfig(),api.getLlmProviders()]);
      const options=Object.entries(config.providers||{}).filter(([id,v]:[string,any])=>v.model&&(id==='chatgpt'?config.chatgpt?.loggedIn:v.apiKeySet)).map(([id,v]:[string,any])=>({key:`${id}::${v.model}`,providerId:id,model:v.model,label:`${providers.find(p=>p.id===id)?.label||id} · ${v.model}`}));
      setModels(options);setModelKey(prev=>options.some(o=>o.key===prev)?prev:options.find(o=>o.providerId===config.provider)?.key||options[0]?.key||'');
    }catch(e:any){setNotice(e.message||'加载模型失败');}
  };
  useEffect(()=>{void refresh();return()=>{controller.current?.abort();run.current++;};},[]);
  useEffect(()=>{if(body.current)body.current.scrollTop=body.current.scrollHeight;},[messages,progress]);
  const scopeText=()=>`${scopeLabels[policy.scope]}${policy.scope==='current'?`：${currentSource?.title||'未选择'}`:policy.scope==='selected'?`（${policy.sourceIds.length} 项）`:''} · 模型知识${policy.allowModelKnowledge?'开':'关'} · 联网${policy.webResearch?'开':'关'}`;
  const invalid=!ready||!input.trim()||!modelKey||(policy.scope==='current'&&!currentSource)||(policy.scope==='selected'&&!policy.sourceIds.length)||(policy.scope==='none'&&!policy.allowModelKnowledge&&!policy.webResearch)||(policy.webResearch&&!searchQuery.trim());
  const send=async()=>{
    if(busy||invalid)return;
    const id=++run.current,c=new AbortController();controller.current=c;
    const question=input.trim(),selected=models.find(m=>m.key===modelKey);
    setMessages(prev=>[...prev,{role:'user',content:question,scope:scopeText()}]);setInput('');setBusy(true);setNotice('');setProgress('正在准备回答');
    try{const result=await askQuestion({question,policy:structuredClone(policy),currentSourceId:currentSource?.id,searchQuery,providerId:selected?.providerId,model:selected?.model},c.signal,message=>{if(run.current===id)setProgress(message);});
      if(run.current===id&&!c.signal.aborted)setMessages(prev=>[...prev,{role:'assistant',content:result.answer,result}]);
    }catch(e:any){if(run.current===id){setInput(question);setMessages(prev=>[...prev,{role:'assistant',content:c.signal.aborted?'已停止回答。':`回答失败：${e.message}`}]);}}
    finally{if(run.current===id){setBusy(false);setProgress('');controller.current=null;}}
  };
  const open=async(c:MemoryCitation)=>{try{await onOpenMemory(c);}catch(e:any){setNotice(e.message||'来源不可读取');}};
  const newChat=()=>{controller.current?.abort();run.current++;setBusy(false);setProgress('');setMessages([]);setInput('');setSearchQuery('');void refresh();};
  return <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div className="flex items-center justify-between px-3 py-2 border-b border-viaim-border text-xs">
      <button onClick={newChat} className="flex items-center gap-1"><Plus className="w-3 h-3"/>新对话</button>
      <button onClick={onOpenSettings} className="flex items-center gap-1"><Settings className="w-3 h-3"/>问答设置</button>
    </div>
    <div ref={body} className="flex-1 min-h-24 overflow-y-auto p-3 space-y-3 select-text custom-scrollbar">
      {!messages.length&&<p className="text-xs text-viaim-textDim leading-relaxed p-3">选择回答来源后提问。可只查自己的资料，也可允许模型知识补充或开启联网研究。输入 @ 或点击“指定资料”可选择会议和文档。</p>}
      {messages.map((m,i)=><div key={i} className={`p-3 rounded-xl text-xs leading-relaxed break-words ${m.role==='user'?'bg-viaim-primary/10 ml-5':'bg-viaim-bg border border-viaim-border'}`}>
        {m.scope&&<p className="text-[10px] text-viaim-textDim mb-2">{m.scope}</p>}
        {m.result?.sections?.length?m.result.sections.map((s,j)=><section key={j} className="mb-3 last:mb-0"><h4 className="font-semibold text-viaim-primary mb-1">{{library:'资料依据',web:'联网研究',model:'模型知识补充 · 未经资料核实'}[s.kind]}</h4><p className="whitespace-pre-wrap">{s.text}</p><p className="text-viaim-textDim text-[10px]">{s.refs.map(r=>`[${r}]`).join(' ')}</p></section>):<p className="whitespace-pre-wrap">{m.content}</p>}
        {m.result&&<>
          <MemoryState projects={m.result.projects||[]} warnings={m.result.memoryWarnings||[]} citations={m.result.citations||[]} onOpen={onOpenMemory}/>
          {!!m.result.citations?.length&&<details className="mt-3"><summary className="cursor-pointer text-viaim-primary">资料引用 · 检索片段</summary>{m.result.citations.map(c=><details key={c.chunkId} className="mt-2"><summary className="cursor-pointer">[{c.ref}] {c.title} · {c.sourceType==='document'?c.location||`页 ${c.pages?.join('、')}`:`${Math.floor(c.startMs/60000)}:${String(Math.floor(c.startMs/1000)%60).padStart(2,'0')}`}</summary><p className="whitespace-pre-wrap max-h-40 overflow-y-auto">{c.excerpt}</p><button className="text-viaim-primary mt-1" onClick={()=>open(c)}>打开来源</button></details>)}</details>}
          {!!m.result.webSources?.length&&<div className="mt-3 space-y-1">{m.result.webSources.map(s=><div key={s.ref}><a className="text-viaim-primary underline" href={s.url} target="_blank" rel="noreferrer">[{s.ref}] {s.title}</a><p className="text-[10px] text-viaim-textDim">检索于 {new Date(s.searchedAt).toLocaleString()}</p></div>)}</div>}
          {m.result.metadata&&<details className="mt-3 text-[10px] text-viaim-textDim"><summary className="cursor-pointer">本次回答来源与模型</summary><p>{scopeLabels[m.result.metadata.policy.scope]} · 模型知识{m.result.metadata.modelKnowledgeAllowed?'允许':'关闭'} · 联网{{off:'关闭',completed:'已读取网页',no_results:'无搜索结果'}[m.result.metadata.webStatus]||m.result.metadata.webStatus}</p>{m.result.metadata.selectedSources.map(s=><p key={s.id}>{s.title}</p>)}{m.result.metadata.searchQuery&&<p>外发搜索词：{m.result.metadata.searchQuery}</p>}<p>回答模型：{m.result.model||'未调用回答模型'}</p><p>依据检索片段，不代表全量结论；引用不保证逐句准确。</p></details>}
        </>}
      </div>)}
      {busy&&<p role="status" className="text-xs text-viaim-primary animate-pulse">{progress}…</p>}
    </div>
    <div className="shrink-0 max-h-[55%] overflow-y-auto p-3 border-t border-viaim-border space-y-2 text-xs bg-viaim-card">
      <QaControls value={policy} onChange={setPolicy} currentSource={currentSource} disabled={busy||!ready} pickerRequest={picker}/>
      {policy.webResearch&&<div className="space-y-1"><input aria-label="外发搜索词" disabled={busy} value={searchQuery} maxLength={400} onChange={e=>setSearchQuery(e.target.value)} placeholder="填写外发搜索词（不自动附带资料正文）" className="w-full bg-viaim-bg rounded-lg border border-viaim-border p-2"/><p className="text-[10px] text-viaim-textDim">仅将上方搜索词发送给 Tavily；请避免包含内部敏感信息。首次使用请配置搜索密钥。</p></div>}
      <div className="flex items-start gap-2"><textarea aria-label="问题" disabled={busy} value={input} maxLength={4000} rows={2} onChange={e=>{const v=e.target.value;if(v.endsWith('@')){setInput(v.slice(0,-1));setPolicy(p=>({...p,scope:'selected'}));setPicker(n=>n+1);}else setInput(v);}} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}} placeholder="输入问题，@ 指定资料…" className="min-w-0 flex-1 bg-viaim-bg border border-viaim-border rounded-lg p-2 resize-none"/>{busy?<button title="停止回答" onClick={()=>controller.current?.abort()} className="p-2 rounded bg-red-500/10"><Square className="w-4 h-4"/></button>:<button title="发送问题" disabled={invalid} onClick={send} className="p-2 rounded bg-viaim-primary text-white disabled:opacity-40"><Send className="w-4 h-4"/></button>}</div>
      <div className="flex flex-wrap justify-between gap-2 text-[11px]"><button disabled={busy||!ready} onClick={()=>{setPolicy(p=>({...p,scope:'selected'}));setPicker(n=>n+1);}} className="text-viaim-primary">@ 指定资料</button><button disabled={busy||!ready} onClick={async()=>{try{await saveQaConfig({defaults:policy});setNotice('已设为默认，将用于新对话');}catch(e:any){setNotice(e.message);}}}>设为默认</button></div>
      <label className="flex items-center gap-2 text-[11px]">回答模型<select aria-label="回答模型" disabled={busy} value={modelKey} onChange={e=>setModelKey(e.target.value)} className="min-w-0 flex-1 bg-viaim-bg border border-viaim-border rounded p-1">{!models.length&&<option value="">请在设置中配置模型，再开启新对话</option>}{models.map(m=><option key={m.key} value={m.key}>{m.label}</option>)}</select></label>
      {policy.scope==='none'&&!policy.allowModelKnowledge&&!policy.webResearch&&<p className="text-amber-600">请至少启用一种回答来源。</p>}
      {notice&&<p role="status" className="text-amber-600 break-words">{notice}</p>}
    </div>
  </div>;
}
