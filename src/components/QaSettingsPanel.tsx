import React,{useEffect,useState} from 'react';
import {QaControls} from './QaControls';
import {defaultQaPolicy,getQaConfig,saveQaConfig} from '../services/qa';
export function QaSettingsPanel(){
  const [policy,setPolicy]=useState(defaultQaPolicy),[key,setKey]=useState(''),[configured,setConfigured]=useState(false),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{getQaConfig().then(c=>{setPolicy(c.defaults);setConfigured(c.searchConfigured);setLoaded(true);}).catch(e=>setMessage(e.message));},[]);
  const save=async(clear=false)=>{setBusy(true);setMessage('');try{const c=await saveQaConfig({defaults:policy,...(clear?{tavilyApiKey:''}:key?{tavilyApiKey:key}:{})});setConfigured(c.searchConfigured);setKey('');setMessage('已保存，将用于新对话');}catch(e:any){setMessage(e.message);}finally{setBusy(false);}};
  return <div className="space-y-4 text-xs">
    <h3 className="font-bold">新对话默认回答来源</h3>
    <QaControls value={policy} onChange={setPolicy} disabled={busy||!loaded}/>
    <p className="text-viaim-textDim">临时调整不会覆盖默认值。选择“当前资料”时，发送问题时确定实际资料。资料与网页可由模型归纳；关闭模型知识表示禁止无依据补充，不能保证模型绝不误读。</p>
    <div className="border border-viaim-border rounded-xl p-3 space-y-2">
      <h3 className="font-bold">联网研究 · Tavily</h3>
      <p>搜索密钥：{configured?'已配置（留空保持不变）':'未配置'}</p>
      <input aria-label="Tavily 搜索密钥" type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} placeholder="输入 Tavily API Key" className="w-full p-2 bg-viaim-bg rounded border border-viaim-border"/>
      <p className="text-viaim-textDim">密钥仅保存在本机后端。搜索词会发送到搜索服务，可能产生费用；每次发送前可编辑外发词，不自动上传资料正文。网页内容会交给回答模型整理。</p>
      <a href="https://app.tavily.com" target="_blank" rel="noreferrer" className="text-viaim-primary">获取搜索密钥</a>
      {configured&&<button disabled={busy||!loaded} onClick={()=>save(true)} className="ml-3 text-red-500">清除密钥</button>}
    </div>
    <button disabled={busy||!loaded} onClick={()=>save()} className="px-3 py-2 bg-viaim-primary text-white rounded-lg disabled:opacity-50">{busy?'保存中…':'保存问答设置'}</button>
    {message&&<p role="status">{message}</p>}
  </div>;
}
