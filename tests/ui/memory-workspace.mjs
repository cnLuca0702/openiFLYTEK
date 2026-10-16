// Run against Vite with an isolated browser and mocked APIs; never reads user data.
// PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.mjs node tests/ui/memory-workspace.mjs
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const info=(id,name)=>({id,name,ext:'pdf',digest:'abc123',uploadedAt:'2026-10-16T12:00:00Z',status:'ready',error:'',pageCount:2,interpreted:2,materialDate:'2026-10-15',replaces:''});
  const files=[info('document:a','设备维护方案.pdf'),info('document:b','接口规范.pdf')];
  const citation={ref:1,chunkId:1,meetingId:'meeting:a',version:'v1',sourceType:'meeting',pages:[],title:'方案评审会议',occurredAt:'2026-10-15',startMs:0,endMs:1000,excerpt:'评审内容',sentenceIds:['s1']};
  const meeting={id:'meeting:a',title:'方案评审会议',category:'会议',createdAt:'2026-10-15',duration:'00:01',audioSource:'本地',status:'completed',speakerCount:1,hasAudio:false,sentences:[{id:'s1',speaker:'张三',time:'00:00',text:'评审内容'}],aiSummary:{generated:false,title:'',abstract:'',topics:[],todos:[]}};
  let empty=false,deleted=false,delay=false;
  await page.route('**/api/**',async route=>{
    const url=new URL(route.request().url()),p=decodeURIComponent(url.pathname);let data={};
    if(p==='/api/meetings')data=[];
    else if(p==='/api/meetings/meeting:a')data=meeting;
    else if(p==='/api/devices/status')data={};
    else if(p==='/api/llm/config')data={provider:'',providers:{},autoSummary:false,chatgpt:{loggedIn:false}};
    else if(p==='/api/llm/providers')data=[];
    else if(p==='/api/documents')data=empty?[]:files;
    else if(p.startsWith('/api/documents/')) {
      const file=files.find(f=>p.endsWith(f.id));
      if(deleted&&file?.id==='document:b')return route.fulfill({status:404,json:{desc:'文档不存在'}});
      if(delay&&file?.id==='document:a')await new Promise(r=>setTimeout(r,500));
      data={...file,pages:[{number:1,label:'第 1 页',text:'第一页原文',image:false},{number:2,label:'第 2 页',text:'第二页来源证据',image:false}],knowledge:[{overview:'方案概览',units:[{question:`${file?.name}的主要知识`,answer:'保养设备并定期核对接口。',basis:'fact',pages:[2]}]}]};
    }
    else if(p==='/api/memory/panorama')data={sources:empty?[]:[...files.map((f,i)=>({id:f.id,title:f.name,type:'document',date:'2026-10-15',chunks:2,facts:2,knowledgeUnits:1,citation:{...citation,meetingId:f.id,sourceType:'document',pages:[1],chunkId:i+2}})),{id:meeting.id,title:meeting.title,type:'meeting',date:'2026-10-15',chunks:1,facts:1,knowledgeUnits:0,citation}],topics:empty?[]:[{id:'topic-a',type:'project',scope:'甲公司',name:'设备维护',sourceIds:['document:a','meeting:a'],facts:3},{id:'topic-b',type:'technology',scope:'',name:'接口设计',sourceIds:['document:b'],facts:2}],topicCount:empty?0:2,totals:{sources:empty?0:3,documents:empty?0:2,meetings:empty?0:1,knowledgeUnits:empty?0:2,facts:empty?0:5},pending:0,unavailable:0,limited:false};
    else if(p==='/api/memory/insights')data={followups:[],changes:[],citations:[],pending:0};
    else if(p.startsWith('/api/memory/evidence'))data=citation;
    else if(p.startsWith('/api/memory/related'))data=[];
    await route.fulfill({json:{code:'000000',data},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto(process.env.UI_URL||'http://127.0.0.1:3107');
  await page.locator('aside').getByRole('button',{name:'记忆与资料',exact:true}).click();
  const work=page.getByRole('main',{name:'记忆与资料工作台'});
  await work.getByRole('heading',{name:'知识全景',exact:true}).waitFor();
  await work.getByRole('button',{name:/设备维护方案.pdf/}).waitFor();
  assert.equal(await page.getByRole('dialog',{name:'记忆与资料',exact:true}).count(),0);
  await work.getByLabel('筛选知识主题').selectOption('topic-b');
  assert.equal(await work.getByRole('button',{name:/设备维护方案.pdf/}).count(),0);
  await work.getByLabel('筛选知识主题').selectOption('');
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/knowledge-panorama.png`});
  await page.locator('aside').getByRole('button',{name:'设备维护方案.pdf',exact:true}).click();
  await work.getByRole('heading',{name:'设备维护方案.pdf的主要知识'}).waitFor();
  await work.getByRole('button',{name:/核对来源/}).click();
  await work.getByText('第二页来源证据',{exact:true}).waitFor();
  assert.equal(await work.getByLabel('来源位置',{exact:true}).inputValue(),'2');
  if(process.env.SCREENSHOT_DIR)await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/document-knowledge.png`});
  await work.getByRole('button',{name:'知识全景',exact:true}).click();
  delay=true;
  await page.locator('aside').getByRole('button',{name:'设备维护方案.pdf',exact:true}).click();
  await page.locator('aside').getByRole('button',{name:'接口规范.pdf',exact:true}).click();
  await work.getByRole('heading',{name:'接口规范.pdf的主要知识'}).waitFor();
  await page.waitForTimeout(650);
  assert.equal(await work.getByRole('heading',{name:'设备维护方案.pdf的主要知识'}).count(),0);
  deleted=true;await work.getByRole('alert').filter({hasText:'文档不存在'}).waitFor({timeout:8000});
  assert.equal(await work.getByRole('heading',{name:'接口规范.pdf的主要知识'}).count(),0);
  deleted=false;
  await page.locator('header').first().getByRole('button',{name:'记忆与资料',exact:true}).click();
  await work.getByRole('button',{name:/方案评审会议/}).click();
  await work.waitFor({state:'hidden'});
  await page.getByText('评审内容',{exact:true}).first().waitFor();
  empty=true;
  await page.locator('aside').getByRole('button',{name:'记忆与资料',exact:true}).click();
  await work.getByText('知识正在这里积累',{exact:true}).waitFor();
  await page.route('**/api/memory/panorama', route => route.fulfill({status:404,contentType:'text/html',body:'<!DOCTYPE html><pre>Cannot GET /api/memory/panorama</pre>'}));
  await work.getByText(/服务返回了非 JSON 响应/).waitFor({timeout:15000});
  assert.deepEqual(errors,[]);
  console.log('UI smoke passed: panorama, topic filtering, inline knowledge/source pages, race protection, deletion, meeting navigation, empty state; no modal or browser errors.');
} finally {await browser.close();}
