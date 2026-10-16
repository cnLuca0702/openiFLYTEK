import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../server/memory_store.js';
import { MemoryService } from '../server/memory_service.js';
import { DocumentService } from '../server/document_service.js';
import { readDocument,readDocumentIsolated } from '../server/document_reader.js';
import { validateFollowup,buildFollowups as deriveFollowups } from '../server/memory_followups.js';
const NOW=Date.parse('2026-10-28T12:00:00+08:00');
const buildFollowups=(facts,now=NOW)=>deriveFollowups(facts,now);
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j8l8AAAAASUVORK5CYII=','base64');
function setup(t,{visual=false,failPage=0}={}) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'document-test-')), store=new MemoryStore(path.join(dir,'notebook.db'));
  let docs;const memory=new MemoryService({store,now:()=>NOW,getMeeting:id=>docs.source(id),listGroups:[{list:()=>docs.list().filter(d=>d.status==='ready'),owns:id=>id.startsWith('document:')} ]});
  const calls=[];
  docs=new DocumentService({memory,root:path.join(dir,'files'),read:async(file,ext,directory)=>[1,2].map(number=>{if(visual)fs.writeFileSync(path.join(directory,`page-${number}.png`),png);return {number,label:`第${number}页`,text:number===1?'晨星项目研发平台预算为八万元。':'晨星平台采用分层架构，适用于教育客户。',...(visual?{image:`page-${number}.png`}:{})};}),ask:async args=>{
    calls.push(args);
    if(Array.isArray(args.user)) {
      const page=JSON.parse(args.user[0].text).page;
      if(page===failPage)throw new Error('no vision');
      return {model:'mock-vision',content:JSON.stringify({readable:true,topic:'研发平台',facts:'晨星项目研发平台预算为八万元。',charts:'分层架构',intent:'介绍'})};
    }
    const pages=JSON.parse(args.user).pages;
    return {model:'mock',content:JSON.stringify({overview:'平台知识',units:[{type:'concept',question:'平台如何支持教师？',answer:'用于教育客户的分层架构。',basis:'synthesis',pages:pages.map(p=>p.number)}]})};
  }});
  docs.verifyVision=async()=>{};
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return {docs,store,memory,calls,dir};
}
test('all visual pages must finish before knowledge and memory; page citations survive restart',async t=>{
  const {docs,store,memory,calls}=setup(t,{visual:true});
  const doc=docs.upload('案例.pdf',Buffer.from('pdf mock'));
  await docs.tick();assert.equal(store.status().sources,0);
  await docs.tick();assert.equal(store.status().sources,0);
  await docs.tick();assert.equal(store.status().sources,0);assert.equal(calls.length,2);
  const resumed=new DocumentService({memory,root:docs.root,ask:docs.ask,read:()=>{throw Error('must not reparse');}});
  resumed.verifyVision=async()=>{};
  await resumed.tick();assert.equal(store.status().sources,0);
  await resumed.tick();assert.equal(resumed.row(doc.id).status,'ready');assert.equal(store.status().sources,1);
  const hits=await memory.recall('晨星');assert.equal(hits[0].sourceType,'document');assert.deepEqual(hits[0].pages,[1]);
  assert.equal(hits[0].occurredAt,'');assert.equal(store.search('教师')[0].meetingId,doc.id);
  assert.ok(fs.existsSync(resumed.file(doc.id,'knowledge')));
  resumed.remove(doc.id);assert.equal(memory.evidence(hits[0].chunkId,hits[0].version),null);assert.equal(store.search('教师').length,0);
});
test('failed vision retains progress and cannot leak text into knowledge',async t=>{
  const {docs,store,calls}=setup(t,{visual:true,failPage:2});const d=docs.upload('扫描.pdf',Buffer.from('scanned'));
  await docs.tick();await docs.tick();await docs.tick();
  assert.equal(docs.detail(d.id).interpreted,1);assert.ok(docs.row(d.id).error);assert.equal(store.status().sources,0);
  assert.equal(calls.length,2);await docs.tick();assert.equal(calls.length,2);
  docs.retry(d.id);await docs.tick();assert.equal(calls.length,3);assert.equal(store.status().sources,0);
});
test('dedup, replacement activates only on success, deleted pending work cannot resurrect',async t=>{
  const {docs,store}=setup(t);const a=docs.upload('旧.txt',Buffer.from('old'));
  for(let i=0;i<3;i++)await docs.tick();
  assert.equal(docs.upload('相同.txt',Buffer.from('old')).id,a.id);
  const b=docs.upload('新.txt',Buffer.from('new'),a.id);assert.equal(docs.row(a.id).status,'ready');
  for(let i=0;i<3;i++)await docs.tick();
  assert.equal(docs.row(a.id).status,'deleted');assert.equal(docs.row(b.id).status,'ready');assert.deepEqual(store.activeIds(),[b.id]);
  const c=docs.upload('删除.txt',Buffer.from('delete'));docs.read=async()=>{docs.remove(c.id);return [{number:1,text:'被删除的资料'}];};await docs.tick();assert.equal(docs.row(c.id).status,'deleted');assert.deepEqual(store.activeIds(),[b.id]);
  assert.throws(()=>docs.upload('../bad.exe',Buffer.from('x')));assert.throws(()=>docs.dir('../../etc'));
});
test('real local text, CSV and PDF parsing preserves page coverage',async t=>{
  const {dir}=setup(t);const txt=path.join(dir,'sample.txt');fs.writeFileSync(txt,'知识文字'.repeat(1500));const pages=await readDocument(txt,'txt',dir);assert.equal(pages.map(p=>p.text).join(''),'知识文字'.repeat(1500));
  const csv=path.join(dir,'sample.csv');fs.writeFileSync(csv,'名称,金额\n"案例,甲",80000');const rows=await readDocument(csv,'csv',dir);assert.match(rows[0].text,/案例,甲/);assert.match(rows[0].label,/第1–2行/);
  // Minimal real two-page PDF, no external fixture/tools required.
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> >>'];
  let pdf='%PDF-1.4\n', offsets=[0];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+='xref\n0 5\n0000000000 65535 f \n'+offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')+`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const file=path.join(dir,'sample.pdf');fs.writeFileSync(file,pdf);const rendered=await readDocument(file,'pdf',dir);assert.equal(rendered.length,2);for(const p of rendered)assert.ok(fs.statSync(path.join(dir,p.image)).size>50);
});
const quote='甲公司晨星项目接口测试由张三负责，截止2026-10-20。';
const open={type:'task',scope:'甲公司',project:'晨星项目',item:'接口测试',event:'open',owner:'张三',due:'2026-10-20'};
function fact(id,day,event='open',q=quote){return {id,source_id:id,chunk_id:Number(id),occurred_at:day,quote:q,followup:validateFollowup({kind:'task',quote:q,followup:{...open,event}})};}
test('followups require evidence, silence never completes, completion/deletion recompute',()=>{
  const a=fact('1','2026-10-10');let result=buildFollowups([a],Date.parse('2026-10-22'));assert.equal(result[0].status,'open');assert.equal(result[0].overdue,true);
  const b=fact('2','2026-10-21','completed','甲公司晨星项目接口测试已完成。');result=buildFollowups([b,a]);assert.equal(result[0].status,'completed');assert.equal(buildFollowups([a])[0].status,'open');
  assert.equal(fact('3','2026-10-22','completed','甲公司晨星项目接口测试尚未完成。').followup,null);
  assert.equal(validateFollowup({quote,followup:{...open,scope:'虚构公司'}}),null);
  assert.equal(buildFollowups([{...a,occurred_at:''},b])[0].status,'uncertain');
  const other={...a,id:'3',followup:{...a.followup,scope:'乙公司'}};assert.equal(buildFollowups([a,other]).length,2);
});
test('question is resolved only with explicit response; conflicting late assertion stays conflict',()=>{
 const q={...open,type:'question',item:'性能问题'};
 const a={id:'1',source_id:'a',chunk_id:1,occurred_at:'2026-10-01',quote:'甲公司晨星项目性能问题待确认。',followup:{...q,event:'open'}};
 const b={id:'2',source_id:'b',chunk_id:2,occurred_at:'2026-10-03',quote:'甲公司晨星项目性能问题已解决，答复是增加缓存。',followup:validateFollowup({quote:'甲公司晨星项目性能问题已解决，答复是增加缓存。',followup:{...q,event:'resolved'}})};
 assert.equal(buildFollowups([a,b])[0].status,'resolved');assert.equal(buildFollowups([a,b,{...a,id:'3',occurred_at:'2026-10-04'}])[0].status,'conflict');
});

test('text-only models cannot pass the image capability gate',async t=>{
  const {docs,store}=setup(t,{visual:true});docs.verifyVision=DocumentService.prototype.verifyVision;
  docs.ask=async()=>({content:'{"code":""}'});const doc=docs.upload('图片.pdf',Buffer.from('mock'));
  await docs.tick();await docs.tick();assert.match(docs.row(doc.id).error,/图片/);assert.equal(store.status().sources,0);assert.equal(docs.detail(doc.id).interpreted,0);
});
test('worker parsing returns recoverable text without blocking the main process',async t=>{
  const {dir}=setup(t);const file=path.join(dir,'worker.txt');fs.writeFileSync(file,'独立工作线程资料');
  assert.equal((await readDocumentIsolated(file,'txt',dir))[0].text,'独立工作线程资料');
});
test('source file loss invalidates citations instead of claiming complete evidence',async t=>{
  const {docs,memory}=setup(t);const doc=docs.upload('材料.txt',Buffer.from('mock'));
  for(let i=0;i<3;i++)await docs.tick();const citation=(await memory.recall('晨星'))[0];assert.ok(citation);
  fs.writeFileSync(docs.file(doc.id,'original'),'changed original');assert.equal(memory.evidence(citation.chunkId,citation.version),null);
  fs.writeFileSync(docs.file(doc.id,'original'),'mock');await memory.sync();assert.ok(memory.evidence(citation.chunkId,citation.version));
  fs.unlinkSync(docs.file(doc.id,'original'));assert.equal(memory.evidence(citation.chunkId,citation.version),null);
});
test('background followup persistence and answer expand both promise and completion evidence',async t=>{
  const {store,memory}=setup(t);const sources=new Map();memory.getMeeting=id=>sources.get(id);memory.listGroups=[{list:()=>[...sources.values()],owns:()=>true}];
  const q1='甲公司晨星项目接口测试由张三负责，截止2026-10-20。',q2='甲公司晨星项目接口测试已完成。';
  for(const [i,quote] of [q1,q2].entries()) {
    const m={id:'meeting'+i,title:'项目会议',createdAt:`2026-10-${i?21:10}`,sentences:[{id:'s1',text:quote}]};sources.set(m.id,m);store.upsert(m);
    memory.ask=async()=>({content:JSON.stringify({facts:[{kind:'task',subject:'晨星项目',claim:quote,quote,chunkId:store.contextFor([m.id])[0].chunkId,followup:{...open,event:i?'completed':'open'}}]})});await memory.tick();
  }
  assert.equal(store.followups(NOW)[0].status,'completed');assert.equal(memory.insights('meeting0').followups.length,1);
  memory.ask=async({user})=>{const input=JSON.parse(user);assert.equal(input.followups[0].status,'completed');assert.equal(input.sources.length,2);return {content:JSON.stringify({answer:'接口测试已有完成证据。[1][2]',citations:[1,2]})};};
  const answer=await memory.answer({question:'张三负责什么'});assert.equal(answer.citations.length,2);
  sources.delete('meeting1');await memory.sync();assert.equal(store.followups(NOW)[0].status,'open');
});

test('DOCX and XLSX preserve paragraphs, sheets and cell references',async t=>{
 const {dir}=setup(t),zip=new JSZip();
 zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
 zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
 zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>研发平台使用分层架构。</w:t></w:r></w:p></w:body></w:document>');
 const doc=path.join(dir,'sample.docx');fs.writeFileSync(doc,await zip.generateAsync({type:'nodebuffer'}));
 assert.match((await readDocument(doc,'docx',dir))[0].text,/分层架构/);
 const workbook=new ExcelJS.Workbook();workbook.addWorksheet('预算').addRows([['项目','金额'],['晨星',80000]]);workbook.addWorksheet('交付').addRows([['接口测试','张三']]);
 const sheet=path.join(dir,'sample.xlsx');await workbook.xlsx.writeFile(sheet);const pages=await readDocument(sheet,'xlsx',dir);
 assert.equal(pages.length,2);assert.match(pages[0].text,/B2=80000/);assert.match(pages[1].label,/交付/);
});
test('five retrieval question classes lead back to original page evidence',async t=>{
 const {docs,store}=setup(t);docs.read=async()=>[{number:1,label:'第 1 页',text:'核心观点是以客户问题驱动。晨星案例面向教育行业。方法包括调研与分析。客户需求是降本增效。专业概念RAG是检索增强生成。'}];
 docs.ask=async()=>({content:JSON.stringify({overview:'项目方法与术语',units:[['concept','核心观点','客户问题驱动'],['case','代表案例','晨星案例'],['method','具体方法','调研与分析'],['need','客户需求','降本增效'],['term','专业概念','RAG']].map(([type,question,answer])=>({type,question,answer,basis:'fact',pages:[1]}))})});
 const doc=docs.upload('五类知识.txt',Buffer.from('five questions'));for(let i=0;i<3;i++)await docs.tick();
 for(const query of ['核心观点','代表案例','具体方法','客户需求','专业概念']) {const hit=store.search(query)[0];assert.equal(hit.meetingId,doc.id);assert.deepEqual(hit.pages,[1]);assert.match(hit.excerpt,/客户问题驱动/);}
});
test('unknown and future dates never complete a task prematurely',()=>{
 const a=fact('1','2026-10-10');const future=fact('2','2027-01-01','completed','甲公司晨星项目接口测试已完成。');
 assert.equal(buildFollowups([a,future],Date.parse('2026-10-15'))[0].status,'uncertain');
});

test('旧版文字资料自动暂存升级，失败保留旧页与索引，成功原子切换',async t=>{
  const {docs,store,memory}=setup(t);
  const doc=docs.upload('legacy.md',Buffer.from('原始文档'));
  await docs.tick();await docs.tick();await docs.tick();
  const old=store.search('晨星')[0];const oldPages=docs.detail(doc.id).pages;
  docs.db.prepare('UPDATE documents SET parser_version=1 WHERE id=?').run(doc.id);
  docs.read=async()=>[{number:1,label:'第一章',text:'# 新结构\n\n保留完整章节和表格。'}];
  await docs.tick();
  assert.deepEqual(docs.detail(doc.id).pages,oldPages);assert.ok(memory.evidence(old.chunkId,old.version));
  const ask=docs.ask;docs.ask=async()=>{throw Error('offline');};await docs.tick();
  assert.equal(docs.row(doc.id).status,'ready');assert.ok(store.evidence(old.chunkId));
  docs.db.prepare('UPDATE document_upgrades SET retry_at=0 WHERE id=?').run(doc.id);docs.ask=ask;
  const resumed=new DocumentService({memory,root:docs.root,read:()=>{throw Error('must resume');},ask});
  await resumed.tick();await resumed.tick();
  assert.equal(resumed.row(doc.id).parser_version,2);
  assert.match(resumed.detail(doc.id).pages[0].text,/新结构/);
  assert.equal(memory.evidence(old.chunkId,old.version),null);
  assert.equal(store.search('完整章节')[0].meetingId,doc.id);
  assert.ok(fs.existsSync(resumed.file(doc.id,'knowledge')));
});

test('文档升级中删除不会重新发布，事务失败保留旧索引',async t=>{
  const {docs,store}=setup(t);
  const doc=docs.upload('legacy.md',Buffer.from('待升级'));
  await docs.tick();await docs.tick();await docs.tick();
  docs.db.prepare('UPDATE documents SET parser_version=1 WHERE id=?').run(doc.id);
  docs.read=async()=>[{number:1,label:'新段',text:'新结构资料'}];
  await docs.tick();await docs.tick();
  const old=store.search('晨星')[0];const upsert=store.upsert.bind(store);
  store.upsert=()=>{throw Error('simulated disk failure');};await docs.tick();store.upsert=upsert;
  assert.equal(docs.row(doc.id).parser_version,1);assert.ok(store.evidence(old.chunkId));
  docs.remove(doc.id);await docs.tick();assert.equal(docs.row(doc.id).status,'deleted');assert.equal(store.status().sources,0);
});

test('实际 DOCX 解析保留标题与表格列关系，Markdown 保留章节边界',async t=>{
  const {dir}=setup(t),zip=new JSZip();
  zip.file('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>设备方案</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>型号</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>数量</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>ZX99</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>3</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');
  const file=path.join(dir,'structured.docx');fs.writeFileSync(file,await zip.generateAsync({type:'nodebuffer'}));
  const pages=await readDocument(file,'docx',dir);const text=pages.map(p=>p.text).join('\n');
  assert.match(text,/# 设备方案/);assert.match(text,/\| ZX99 \| 3 \|/);assert.match(text,/\| 型号 \| 数量 \|/);
  const md=path.join(dir,'structured.md');fs.writeFileSync(md,'# 第一章\n\n设备要求\n\n# 第二章\n\n接口要求');
  const sections=await readDocument(md,'md',dir);assert.equal(sections.length,2);assert.match(sections[1].label,/第二章/);
});
