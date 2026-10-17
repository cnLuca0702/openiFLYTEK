// Search and extraction run at a fixed provider endpoint; local files/URLs are never fetched here.
export function publicWebUrl(value) {
  try { const u=new URL(value);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password&&u.hostname.includes('.')&&!/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)?u.href:null; } catch {return null;}
}
export async function researchWeb({query,apiKey,signal,onProgress=()=>{},fetchImpl=fetch}) {
  if(!apiKey)throw new Error('请在设置 → AI 问答中配置 Tavily 搜索密钥');
  if(typeof query!=='string'||!query.trim()||query.length>400)throw new Error('请填写 1–400 字的外发搜索词');
  const request=async(endpoint,body)=>{
    signal?.throwIfAborted();
    const response=await fetchImpl(`https://api.tavily.com/${endpoint}`,{method:'POST',signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(45000)]),headers:{'Content-Type':'application/json',Authorization:`Bearer ${apiKey}`},body:JSON.stringify(body)});
    if(!response.ok)throw new Error(`联网${endpoint==='search'?'搜索':'读取网页'}失败（HTTP ${response.status}），请检查搜索密钥或稍后重试`);
    return response.json();
  };
  onProgress('search','正在搜索网页');
  const search=await request('search',{query:query.trim(),search_depth:'advanced',max_results:5,include_answer:false,include_raw_content:false});
  const candidates=[...new Map((search.results||[]).filter(r=>publicWebUrl(r.url)).map(r=>[publicWebUrl(r.url),r])).values()].slice(0,5);
  if(!candidates.length)return {sources:[],warnings:['联网搜索未找到可用网页'],searchedAt:new Date().toISOString()};
  onProgress('reading','正在读取网页正文');
  const extracted=await request('extract',{urls:candidates.map(r=>publicWebUrl(r.url)),extract_depth:'advanced',format:'text'});
  const results=extracted.results||[],time=new Date().toISOString();
  const sources=candidates.map(r=>{
    const raw=results.find(e=>publicWebUrl(e.url)===publicWebUrl(r.url));
    if(typeof raw?.raw_content!=='string'||!raw.raw_content.trim())return null;
    return {url:publicWebUrl(r.url),title:String(r.title||r.url).slice(0,300),text:raw.raw_content.slice(0,9000),searchedAt:time};
  }).filter(Boolean).map((r,i)=>({...r,ref:`W${i+1}`}));
  if(!sources.length)throw new Error('已搜索到网页，但无法读取正文；本次未生成联网结论，请重试');
  return {sources,warnings:sources.length<candidates.length?['部分网页读取失败，仅依据成功读取的页面回答']:[],searchedAt:time};
}
