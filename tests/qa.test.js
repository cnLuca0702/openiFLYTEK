import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MemoryStore} from '../server/memory_store.js';
import {MemoryService} from '../server/memory_service.js';
import {answerQuestion} from '../server/qa_service.js';
import {DEFAULT_POLICY,validatePolicy,saveQaConfig,publicQaConfig,readQaConfig} from '../server/qa_config.js';
import {researchWeb} from '../server/web_research.js';
function fixture(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-policy-')),store=new MemoryStore(path.join(dir,'test.db'));
  const entries=new Map(['local:a','local:b','document:a'].map(id=>[id,{id,title:id,sentences:[{id:id.startsWith('document:')?'page:1':'s1',text:`预算为八万元 ${id}`,speaker:'张三'}]}]));
  const memory=new MemoryService({store,getMeeting:id=>entries.get(id),listGroups:[{list:()=>[...entries.values()],owns:()=>true}],embeddings:{search:async()=>[],status:()=>({}),stop(){}}});
  t.after(()=>{memory.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});});return {dir,memory,entries};
}
const policy=(scope='all',extra={})=>({...DEFAULT_POLICY,scope,...extra});
const sourceAnswer=async args=>{const data=JSON.parse(args.user);return {model:'mock',content:JSON.stringify({sections:data.librarySources.map(s=>({kind:'library',text:`预算依据[${s.ref}]`,refs:[s.ref]}))})};};
test('all, current, type and mixed selection are isolated; wording never silently narrows all',async t=>{
  const {memory}=fixture(t);
  for(const [p,current,expected] of [[policy(), 'local:a',['local:a','local:b','document:a']],[policy('current'),'document:a',['document:a']],[policy('meetings'),null,['local:a','local:b']],[policy('documents'),null,['document:a']],[policy('selected',{sourceIds:['local:b','document:a']}),null,['local:b','document:a']]]){
    const r=await answerQuestion({question:'这次预算是多少',policy:p,currentSourceId:current},{memory,ask:sourceAnswer});
    assert.deepEqual(r.citations.map(c=>c.meetingId).sort(),expected.sort());
    assert.equal(r.metadata.policy.scope,p.scope);
  }
});
test('empty type scope does not turn into all; invalid explicit and current scope reject',async t=>{
  const {memory,entries}=fixture(t);entries.delete('document:a');let called=false;
  const r=await answerQuestion({question:'预算',policy:policy('documents')},{memory,ask:()=>{called=true;}});
  assert.equal(called,false);assert.deepEqual(r.citations,[]);
  await assert.rejects(answerQuestion({question:'预算',policy:policy('selected',{sourceIds:['document:a']})},{memory}),/删除|不可读取/);
  await assert.rejects(answerQuestion({question:'预算',policy:policy('current')},{memory}),/当前未选择/);
});
test('model-only never reads memory or searches; toggles and references are enforced',async()=>{
  const result=await answerQuestion({question:'解释概念',policy:policy('none',{allowModelKnowledge:true})},{memory:{listGroups:[{list(){throw new Error('must not read');}}]},research(){throw new Error('must not search');},ask:async args=>{
    assert.deepEqual(JSON.parse(args.user).librarySources,[]);return {content:JSON.stringify({sections:[{kind:'model',text:'模型补充',refs:[]}]}),model:'mock'};
  }});assert.equal(result.sections[0].kind,'model');
  assert.throws(()=>validatePolicy(policy('none')),/至少/);
  assert.throws(()=>validatePolicy({...policy(),allowModelKnowledge:'false'}),/开关/);
});
test('forbidden model supplements, missing or fabricated citations reject, changed sources reject',async t=>{
  const {memory,entries}=fixture(t);
  for(const section of [{kind:'model',text:'不应补充',refs:[]},{kind:'library',text:'断言',refs:[]},{kind:'library',text:'错误[99]',refs:[1]}]){
    await assert.rejects(answerQuestion({question:'预算',policy:policy()},{memory,ask:async()=>({content:JSON.stringify({sections:[section]})})}),/未授权|无效引用/);
  }
  await assert.rejects(answerQuestion({question:'预算',policy:policy()},{memory,ask:async args=>{entries.delete('local:a');return sourceAnswer(args);}}),/变更/);
});
test('web-only and mixed knowledge keep provenance; query is explicit and cancellation propagates',async t=>{
  const {memory}=fixture(t),controller=new AbortController(),progress=[];
  const p=policy('selected',{sourceIds:['local:a'],allowModelKnowledge:true,webResearch:true});
  const result=await answerQuestion({question:'内部资料和市场如何比较',policy:p,searchQuery:'公开市场信息'}, {memory,signal:controller.signal,onProgress:s=>progress.push(s),research:async args=>{
    assert.equal(args.query,'公开市场信息');assert.equal(args.signal,controller.signal);assert.equal(args.question,undefined);
    return {sources:[{ref:'W1',title:'公开资料',url:'https://example.com/report',text:'网页正文',searchedAt:'2026-10-17'}],warnings:[],searchedAt:'2026-10-17'};
  },ask:async()=>({model:'mock',content:JSON.stringify({sections:[{kind:'library',text:'内部依据[1]',refs:[1]},{kind:'web',text:'网页依据[W1]',refs:['W1']},{kind:'model',text:'一般解释',refs:[]}]})})});
  assert.equal(result.sections.length,3);assert.equal(result.webSources[0].text,undefined);assert.equal(result.metadata.searchQuery,'公开市场信息');assert.equal(result.citations.length,1);
  controller.abort();await assert.rejects(answerQuestion({question:'预算',policy:p},{memory,signal:controller.signal}),/abort/i);
  let asked=false;await assert.rejects(answerQuestion({question:'预算',policy:policy('none',{webResearch:true}),searchQuery:'公开词'},{research:async()=>{throw new Error('搜索失败');},ask:()=>{asked=true;}}),/搜索失败/);assert.equal(asked,false);
});
test('Tavily adapter searches then extracts only selected public URLs, never uses snippets as read pages',async()=>{
  const requests=[],stages=[];
  const fetchImpl=async(url,opts)=>{requests.push({url,...JSON.parse(opts.body)});return {ok:true,json:async()=>url.endsWith('/search')?{results:[{url:'https://example.com/a',title:'页面A',content:'摘要'},{url:'http://127.0.0.1/private'},{url:'https://example.com/b'}]}:{results:[{url:'https://example.com/a',raw_content:'实际正文'}]}};};
  const r=await researchWeb({query:'公开查询',apiKey:'fake',fetchImpl,onProgress:s=>stages.push(s)});
  assert.deepEqual(stages,['search','reading']);assert.deepEqual(requests[1].urls,['https://example.com/a','https://example.com/b']);assert.equal(r.sources[0].text,'实际正文');assert.equal(r.sources.length,1);assert.equal(r.warnings.length,1);
  await assert.rejects(researchWeb({query:'公开查询',apiKey:'',fetchImpl}),/密钥/);
  await assert.rejects(researchWeb({query:'',apiKey:'fake',fetchImpl}),/外发搜索词/);
  await assert.rejects(researchWeb({query:'公开查询',apiKey:'fake',fetchImpl:async()=>({ok:false,status:401})}),/401/);
});
test('defaults persist atomically; keys are masked from public config, omitted retains and empty removes',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qa-config-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'qa.json');
  assert.deepEqual(publicQaConfig(file).defaults,DEFAULT_POLICY);
  const saved=saveQaConfig({defaults:policy('selected',{sourceIds:['document:a']}),tavilyApiKey:'secret'},file);
  assert.equal(JSON.stringify(saved).includes('secret'),false);assert.equal(saved.searchConfigured,true);
  saveQaConfig({defaults:policy('none',{allowModelKnowledge:true})},file);assert.equal(readQaConfig(file).tavilyApiKey,'secret');
  assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(saveQaConfig({tavilyApiKey:''},file).searchConfigured,false);
  assert.throws(()=>saveQaConfig({defaults:policy('selected')},file),/至少/);
});
