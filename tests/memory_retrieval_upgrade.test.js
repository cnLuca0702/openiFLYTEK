import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {MemoryStore} from '../server/memory_store.js';
import {MemoryService} from '../server/memory_service.js';
import {MemoryEmbeddings,embedTexts,normalizeVector} from '../server/memory_embeddings.js';
import {splitStructured,officeHtmlText} from '../server/document_structure.js';
import {evidenceEntities} from '../server/memory_relations.js';

const meeting=(id,text)=>({id,title:id,createdAt:'2026-10-16',sentences:[{id:id.startsWith('document:')?'page:1':'s1',text,speaker:'来源',startTimeMs:1000}]});
function setup(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'retrieval-upgrade-'));
  const file=path.join(dir,'test.db'),store=new MemoryStore(file),sources=new Map();
  const service=new MemoryService({store,getMeeting:id=>sources.get(id),listGroups:[{list:()=>[...sources.values()],owns:()=>true}]});
  const put=(id,text)=>{const m=meeting(id,text);sources.set(id,m);store.upsert(m);return m;};
  t.after(()=>{service.stop();store.close();fs.rmSync(dir,{recursive:true,force:true});});
  return {store,service,put,sources,file};
}
const profile={key:'profile-a',baseUrl:'http://example.invalid/v1',model:'test'};
const embed=async(_,texts)=>texts.map(text=> /停机|连续性/.test(text)?[1,0,0]:[0,1,0]);

test('结构切块保留章节、行与所有正文，长段优先句界',()=>{
  const text='# 第一章\n\n'+('设备运行正常。'.repeat(100))+'\n\n## 数据\n\n| 项目 | 数值 |\n| A | 10 |\n| B | 20 |';
  const parts=splitStructured(text,300);
  assert.ok(parts.length>3);assert.ok(parts.every(p=>p.length<=300));
  assert.equal(parts.join('').replace(/\s/g,''),text.replace(/\s/g,''));
  assert.ok(parts.some(p=>p.includes('| A | 10 |\n| B | 20 |')));
  const converted=officeHtmlText('<h1>方案</h1><p>描述</p><table><tr><td>型号</td><td>数量</td></tr><tr><td>A&amp;B</td><td>3</td></tr></table>');
  assert.match(converted,/# 方案/);assert.match(converted,/\| A&B \| 3 \|/);
});

test('同义问题由向量补召回，指定范围隔离，删除和版本变更即时失效',async t=>{
  const {store,service,put,sources}=setup(t);
  put('a','降低设备停机损失。');put('b','食堂菜单调整。');
  const vectors=new MemoryEmbeddings(store,{runtime:()=>profile,embed});service.embeddings=vectors;
  await vectors.tick();assert.equal(vectors.status().state,'ready');
  assert.equal(store.search('提高生产连续性').length,0);
  assert.equal((await service.recall('提高生产连续性'))[0].meetingId,'a');
  assert.ok((await service.recall('提高生产连续性',{meetingIds:['b']})).every(c=>c.meetingId==='b'));
  put('a','食堂新增菜品。');assert.deepEqual(await vectors.search('提高生产连续性'),[]);
  await vectors.tick();sources.delete('b');await service.sync();
  assert.ok(!(await vectors.search('食堂')).some(c=>c.meetingId==='b'));
});

test('向量故障持久退避，全文检索可用；模型切换不混用旧向量',async t=>{
  const {store,service,put}=setup(t);put('a','ZX99降低设备停机损失。');
  let config=profile,fail=false,calls=0;
  const vectors=new MemoryEmbeddings(store,{runtime:()=>config,embed:async(...args)=>{calls++;if(fail)throw Error('offline');return embed(...args);}});service.embeddings=vectors;
  await vectors.tick();config={...profile,key:'profile-b',model:'other'};
  assert.equal(vectors.status().pending,1);assert.deepEqual(await vectors.search('生产连续性'),[]);
  fail=true;await vectors.tick();const before=calls;await vectors.tick();assert.equal(calls,before);
  assert.equal(vectors.status().state,'retrying');
  assert.equal((await service.recall('ZX99'))[0].meetingId,'a');
  const restarted=new MemoryEmbeddings(store,{runtime:()=>config,embed});assert.equal(restarted.status().state,'retrying');restarted.stop();
});

test('异步向量结果不能恢复已失效或删除的来源',async t=>{
  const {store,put}=setup(t);put('a','旧版本');
  let release;const vectors=new MemoryEmbeddings(store,{runtime:()=>profile,embed:()=>new Promise(r=>{release=r;})});
  const pending=vectors.tick();store.remove('a');release([[1,0]]);await pending;
  assert.equal(store.db.prepare('SELECT count(*) n FROM memory_vectors').get().n,0);vectors.stop();
});

test('向量协议校验返回顺序、数量、维度、零向量和非法数字',async()=>{
  const fetcher=async()=>({ok:true,json:async()=>({data:[{index:1,embedding:[0,2]},{index:0,embedding:[3,0]}]})});
  assert.deepEqual(await embedTexts(profile,['a','b'],{fetcher}),[[1,0],[0,1]]);
  assert.throws(()=>normalizeVector([0,0]));assert.throws(()=>normalizeVector([NaN,1]));
  await assert.rejects(embedTexts(profile,['a'],{fetcher}));
  await assert.rejects(embedTexts(profile,['a','b'],{fetcher:async()=>({ok:true,json:async()=>({data:[{index:0,embedding:[1,0]},{index:0,embedding:[0,1]}]})})}));
});

function extract(store, entities) {
  let job;while((job=store.nextJob())) {
    store.finishJob(job,job.chunks.map(c=>({chunkId:c.id,kind:'fact',subject:'技术说明',claim:c.text,quote:c.text,entities:entities(c.text)})));
  }
}
test('共用技术实体扩展会议与文档证据，不改变项目状态，并严格遵守范围',async t=>{
  const {store,service,put}=setup(t);
  put('meeting-a','ZX99设备采用热备切换技术。');put('document:b','热备切换技术通过备用设备维持生产。');
  put('document:c','食堂采用新菜单。');
  extract(store,text=>text.includes('热备切换')?[{type:'technology',name:'热备切换',scope:''}]:[]);
  const hits=await service.recall('ZX99');assert.deepEqual(new Set(hits.map(c=>c.meetingId)),new Set(['meeting-a','document:b']));
  assert.deepEqual(store.projectMemory(),[]);assert.deepEqual(store.followups(),[]);
  assert.deepEqual((await service.recall('ZX99',{meetingIds:['meeting-a']})).map(c=>c.meetingId),['meeting-a']);
  store.remove('document:b');assert.deepEqual(store.related([store.search('ZX99')[0]]),[]);
});

test('同名不同单位项目不关联，缺少身份及无逐字证据的实体拒绝',t=>{
  const {store,put}=setup(t);put('a','甲公司晨星项目采用ZX99设备。');put('b','乙公司晨星项目预算十万元。');put('c','甲公司晨星项目预算八万元。');
  extract(store,text=>[{type:'project',name:'晨星项目',scope:text.includes('甲公司')?'甲公司':'乙公司'}]);
  assert.deepEqual(store.related([store.search('ZX99')[0]]).map(c=>c.meetingId),['c']);
  assert.deepEqual(evidenceEntities({quote:'晨星项目启动。',entities:[{type:'project',name:'晨星项目'},{type:'technology',name:'不存在技术'}]}),[]);
});

test('自动升级旧文档索引时原词与知识检索扩展保留，旧引用失效',t=>{
  const {store,put}=setup(t);const m=put('document:a','# 标题\n\n'+('正文。'.repeat(450)));
  const old=store.search('正文')[0];
  // Simulate a previous format's stored version; current chunks remain until commit.
  store.db.prepare("UPDATE memory_sources SET version='legacy' WHERE id=?").run(m.id);
  store.db.prepare("UPDATE memory_chunks SET version='legacy' WHERE source_id=?").run(m.id);
  m.knowledge=[{units:[{question:'特殊检索词',answer:'扩展',pages:[1]}]}];
  store.upsert(m);assert.equal(store.search('特殊检索词')[0].meetingId,m.id);
  assert.equal(store.evidence(old.chunkId),null);
  assert.ok(store.search('正文').every(c=>c.pages.includes(1)));
});

test('本地 HTTP 向量协议贯通后台建库、问答引用及查询故障回退',async t=>{
  const {createServer}=await import('node:http');
  let failed=false;
  const server=createServer(async(req,res)=>{
    let body='';for await(const bytes of req)body+=bytes;
    assert.equal(req.url,'/v1/embeddings');assert.equal(req.headers.authorization,'Bearer local-test-key');
    if(failed){res.writeHead(503);res.end();return;}
    const request=JSON.parse(body);assert.equal(request.model,'fixture');
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:request.input.map((text,index)=>({index,embedding:/停机|连续性/.test(text)?[1,0]:[0,1]}))}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const {store,service,put}=setup(t);put('a','ZX99设备降低停机损失。');
  service.embeddings=new MemoryEmbeddings(store,{runtime:()=>({key:'http',baseUrl:`http://127.0.0.1:${server.address().port}/v1`,model:'fixture',apiKey:'local-test-key'})});
  await service.embeddings.tick();
  service.ask=async args=>{const data=JSON.parse(args.user);assert.equal(data.sources[0].meetingId,'a');return {model:'fixture',content:JSON.stringify({answer:'设备有相关措施[1]',citations:[1]})};};
  const answer=await service.answer({question:'如何提高生产连续性'});
  assert.equal(answer.citations[0].meetingId,'a');
  failed=true;
  const fallback=await service.answer({question:'ZX99'});
  assert.ok(fallback.memoryWarnings.some(w=>w.includes('回退全文')));
});

test('文档长章节后续切块保留章节提示，页码不变',t=>{
  const {store,put}=setup(t);put('document:chapter','# 设备维护\n\n'+('应按期检查密封圈。'.repeat(300)));
  const rows=store.db.prepare('SELECT * FROM memory_chunks ORDER BY ordinal').all();
  assert.ok(rows.length>2);assert.ok(rows.every(r=>r.text.includes('# 设备维护')));
  assert.ok(rows.every(r=>JSON.parse(r.sentence_ids).every(id=>id==='page:1')));
});

test('知识全景仅汇总有效可读来源与真实实体关联，删除和同名范围不串联',async t=>{
  const {memoryPanorama}=await import('../server/memory_panorama.js');
  const {store,service,put}=setup(t);
  put('a','甲公司晨星项目使用ZX99。');const doc=put('document:b','甲公司晨星项目采用热备。');
  doc.knowledge=[{units:[{question:'技术',answer:'热备',pages:[1]}]}];
  put('c','乙公司晨星项目预算不同。');
  extract(store,text=>[{type:'project',name:'晨星项目',scope:text.includes('甲公司')?'甲公司':'乙公司'}]);
  const result=memoryPanorama(service);
  assert.equal(result.totals.sources,3);assert.equal(result.totals.knowledgeUnits,1);
  assert.equal(result.totals.documents,1);assert.equal(result.totals.meetings,2);
  assert.equal(result.topics.length,2);
  assert.deepEqual(new Set(result.topics.find(t=>t.scope==='甲公司').sourceIds),new Set(['a','document:b']));
  store.remove('document:b');assert.equal(memoryPanorama(service).totals.knowledgeUnits,0);
  service.getMeeting=id=>id==='c'?null:meeting('a','甲公司晨星项目使用ZX99。');
  assert.ok(!memoryPanorama(service).sources.some(s=>s.id==='c'));
});
