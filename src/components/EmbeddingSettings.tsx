import {useEffect,useState} from 'react';
import {api} from '../services/api';

export function EmbeddingSettings() {
  const [status,setStatus]=useState<{state:string;indexed:number;pending:number}|null>(null);
  useEffect(()=>{let live=true;const load=()=>api.memoryStatus().then(s=>{if(live)setStatus(s.semantic||null);}).catch(()=>{});void load();const timer=setInterval(load,5000);return()=>{live=false;clearInterval(timer);};},[]);
  const [form,setForm]=useState({enabled:false,baseUrl:'',model:'',apiKey:''});
  const [keySet,setKeySet]=useState(false),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{let live=true;api.getLlmConfig().then(c=>{if(!live)return;if(c.embedding){setForm({...c.embedding,apiKey:''});setKeySet(c.embedding.apiKeySet);}setLoaded(true);}).catch(()=>{if(live)setMessage('无法读取语义检索设置');});return()=>{live=false;};},[]);
  const save=async()=>{setBusy(true);setMessage('');try {const c=await api.saveLlmConfig({embedding:{...form,apiKey:form.apiKey||undefined}});setKeySet(!!c.embedding?.apiKeySet);setForm(f=>({...f,apiKey:''}));setMessage('已保存。资料将在后台自动建立语义索引。');}catch(e:any){setMessage(e.message);}finally{setBusy(false);}};
  return <details className="border border-viaim-border rounded-lg p-3 text-xs">
    <summary className="cursor-pointer font-semibold">记忆语义检索</summary>
    <p className="text-viaim-textDim my-2">使用独立向量模型理解不同措辞。配置后自动整理已有和新资料；未配置或连接失败时仍使用全文检索。资料片段会发送到此服务，可能产生用量。ChatGPT 登录不能代替向量服务密钥。</p>
    <label className="flex gap-2 my-2"><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})}/>启用语义检索</label>
    {(['baseUrl','model','apiKey'] as const).map((k,i)=><label key={k} className="block my-2">{['服务地址（含 /v1 等接口前缀）','向量模型名称','API Key（本地无鉴权服务可留空）'][i]}<input className="block w-full mt-1 p-2 bg-slate-800 rounded" type={k==='apiKey'?'password':'text'} value={form[k]} placeholder={k==='apiKey'&&keySet?'已保存，留空保持不变':''} onChange={e=>setForm({...form,[k]:e.target.value})}/></label>)}
    <button disabled={busy||!loaded} onClick={()=>void save()} className="text-cyan-300 disabled:opacity-50">{busy?'保存中…':'保存语义检索设置'}</button>
    {status&&<p className="mt-2 text-viaim-textDim">{({unconfigured:'未启用：使用全文检索',indexing:'后台建立语义索引',retrying:'连接或模型返回异常，将自动重试；全文检索仍可用',ready:'语义索引已就绪'} as Record<string,string>)[status.state]}{status.state!=='unconfigured'&&` · 已完成 ${status.indexed} 段，待处理 ${status.pending} 段`}</p>}
    {message&&<p role="status" className="mt-2">{message}</p>}
  </details>;
}
