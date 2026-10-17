import fs from 'node:fs';
import path from 'node:path';
import { APP_DATA_DIR } from './storage_paths.js';
export const QA_CONFIG_PATH = path.join(APP_DATA_DIR, 'config', 'qa.json');
export const DEFAULT_POLICY = { scope: 'all', sourceIds: [], allowModelKnowledge: false, webResearch: false };
export function validatePolicy(value = DEFAULT_POLICY) {
  if (!value || !['all','meetings','documents','current','selected','none'].includes(value.scope)) throw new Error('无效的回答资料范围');
  if (typeof value.allowModelKnowledge !== 'boolean' || typeof value.webResearch !== 'boolean') throw new Error('请明确选择模型知识与联网研究开关');
  if (!Array.isArray(value.sourceIds) || value.sourceIds.length > 50 || value.sourceIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 300)) throw new Error('资料范围最多选择 50 项有效资料');
  const sourceIds = value.scope === 'selected' ? [...new Set(value.sourceIds)] : [];
  if (value.scope === 'selected' && !sourceIds.length) throw new Error('请至少指定一项资料');
  if (value.scope === 'none' && !value.allowModelKnowledge && !value.webResearch) throw new Error('请至少启用一种回答来源');
  return {scope:value.scope,sourceIds,allowModelKnowledge:value.allowModelKnowledge,webResearch:value.webResearch};
}
export function readQaConfig(file = QA_CONFIG_PATH) {
  try { const value=JSON.parse(fs.readFileSync(file,'utf8')); return {defaults:validatePolicy(value.defaults),tavilyApiKey:String(value.tavilyApiKey||'')}; }
  catch (e) { if(e.code==='ENOENT')return {defaults:{...DEFAULT_POLICY},tavilyApiKey:''}; throw new Error('问答配置读取失败，请重新保存设置'); }
}
export function publicQaConfig(file = QA_CONFIG_PATH) {
  const c=readQaConfig(file);return {defaults:c.defaults,searchProvider:'tavily',searchConfigured:!!c.tavilyApiKey};
}
export function saveQaConfig(patch, file = QA_CONFIG_PATH) {
  const c=readQaConfig(file);
  if(patch.defaults!==undefined)c.defaults=validatePolicy(patch.defaults);
  if(patch.tavilyApiKey!==undefined){
    if(typeof patch.tavilyApiKey!=='string'||patch.tavilyApiKey.length>1000)throw new Error('无效的搜索服务密钥');
    c.tavilyApiKey=patch.tavilyApiKey.trim();
  }
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=`${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary,JSON.stringify(c),{mode:0o600});fs.chmodSync(temporary,0o600);fs.renameSync(temporary,file);
  return publicQaConfig(file);
}
