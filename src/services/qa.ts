import { MemoryCitation, MemoryProject } from './api';
export type QaScope = 'all'|'meetings'|'documents'|'current'|'selected'|'none';
export interface QaPolicy {scope:QaScope;sourceIds:string[];allowModelKnowledge:boolean;webResearch:boolean}
export interface QaSource {id:string;title:string;type:'meeting'|'document'}
export interface QaConfig {defaults:QaPolicy;searchProvider:string;searchConfigured:boolean}
export interface QaResult {
  answer:string;model:string;citations?:MemoryCitation[];projects?:MemoryProject[];memoryWarnings?:string[];
  sections?:Array<{kind:'library'|'web'|'model';text:string;refs:Array<string|number>}>;
  webSources?:Array<{ref:string;title:string;url:string;searchedAt:string}>;
  metadata?:{policy:QaPolicy;selectedSources:QaSource[];searchQuery:string|null;searchedAt:string|null;webStatus:string;modelKnowledgeAllowed:boolean};
}
export const defaultQaPolicy:QaPolicy={scope:'all',sourceIds:[],allowModelKnowledge:false,webResearch:false};
export const scopeLabels:Record<QaScope,string>={all:'全部会议与资料',meetings:'仅会议',documents:'仅文档',current:'当前资料',selected:'指定资料',none:'不使用资料库'};
const base='http://localhost:3800/api/ai';
async function request<T>(path:string,body?:unknown):Promise<T>{
  const r=await fetch(base+path,body===undefined?undefined:{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  const j=await r.json();if(!r.ok||j.code!=='000000')throw new Error(j.desc||'问答设置读取失败');return j.data;
}
export const getQaConfig=async()=>{const c=await request<QaConfig>('/config');if(!c?.defaults||!scopeLabels[c.defaults.scope]||!Array.isArray(c.defaults.sourceIds))throw new Error('后端问答配置无效，请重启应用后重试');return c;};
export const saveQaConfig=(patch:{defaults?:QaPolicy;tavilyApiKey?:string})=>request<QaConfig>('/config',patch);
export const getQaSources=async()=>{const r=await request<{sources:QaSource[];warnings:string[]}>('/sources');if(!Array.isArray(r?.sources))throw new Error('资料列表不可用，请检查后端服务');return {...r,warnings:r.warnings||[]};};
export async function askQuestion(payload:{question:string;policy:QaPolicy;currentSourceId?:string;searchQuery?:string;providerId?:string;model?:string}, signal:AbortSignal,onProgress:(message:string)=>void):Promise<QaResult>{
  const response=await fetch(base+'/chat',{method:'POST',signal,headers:{'Content-Type':'application/json',Accept:'application/x-ndjson'},body:JSON.stringify(payload)});
  if(!response.ok)throw new Error('问答请求失败，请检查后端服务');
  if(!response.headers.get('content-type')?.includes('application/x-ndjson'))throw new Error('后端不支持新版问答，请重启应用后重试');
  const reader=response.body!.getReader(),decoder=new TextDecoder();let buffer='',result:QaResult|undefined;
  const process=(line:string)=>{if(!line.trim())return;const e=JSON.parse(line);if(e.type==='progress')onProgress(e.message);if(e.type==='error')throw new Error(e.message);if(e.type==='result')result=e.data;};
  try {while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});const lines=buffer.split('\n');buffer=lines.pop()||'';lines.forEach(process);}buffer+=decoder.decode();process(buffer);}
  finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  if(!result)throw new Error('回答连接中断，请重试');return result;
}
