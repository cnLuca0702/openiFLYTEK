// UI regression: mock providers and NDJSON; never calls external models/search.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1080,height:900}}),errors=[],requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  const meeting={id:'local:a',title:'项目会议',source:'local',category:'会议',createdAt:'2026-10-17',duration:'00:01',status:'completed',sentences:[],aiSummary:{generated:false,topics:[],todos:[]}};
  const sources=[{id:meeting.id,title:meeting.title,type:'meeting'},{id:'document:a',title:'产品手册.pdf',type:'document'}];
  let defaults={scope:'all',sourceIds:[],allowModelKnowledge:false,webResearch:false},key='',delay=false;
  await page.route('**/api/**',async route=>{
    const p=new URL(route.request().url()).pathname;let data={};
    if(p==='/api/meetings')data=[meeting];
    else if(p.startsWith('/api/meetings/'))data=meeting;
    else if(p==='/api/llm/config')data={provider:'custom',providers:{custom:{model:'fixture',apiKeySet:true}},chatgpt:{loggedIn:false}};
    else if(p==='/api/llm/providers')data=[{id:'custom',label:'测试模型'}];
    else if(p==='/api/ai/config'){
      if(route.request().method()==='PUT'){const b=route.request().postDataJSON();if(b.defaults)defaults=b.defaults;if(b.tavilyApiKey!==undefined)key=b.tavilyApiKey;}
      data={defaults,searchProvider:'tavily',searchConfigured:!!key};
    }
    else if(p==='/api/ai/sources')data={sources,warnings:[]};
    else if(p==='/api/documents')data=[{id:'document:a',name:'产品手册.pdf',ext:'pdf',status:'ready',pageCount:1,interpreted:1}];
    else if(p.startsWith('/api/documents/'))data={id:'document:a',name:'产品手册.pdf',ext:'pdf',status:'ready',pages:[{number:1,label:'第1页',text:'产品原文'}],knowledge:[{overview:'产品知识',units:[{question:'如何使用',answer:'操作说明',basis:'fact',pages:[1]}]}]};
    else if(p==='/api/memory/panorama')data={sources:[],topics:[],totals:{sources:0,documents:0,meetings:0,knowledgeUnits:0,facts:0},pending:0,unavailable:0,limited:false};
    else if(p==='/api/memory/insights')data={followups:[],changes:[],citations:[],pending:0};
    else if(p==='/api/ai/chat'){
      const b=route.request().postDataJSON();requests.push(b);
      if(delay)await new Promise(r=>setTimeout(r,1000));
      const sections=[{kind:b.policy.allowModelKnowledge?'model':b.policy.webResearch?'web':'library',text:'回答内容',refs:b.policy.allowModelKnowledge?[]:b.policy.webResearch?['W1']:[1]}];
      const result={answer:'回答内容',sections,model:'fixture',citations:[],webSources:b.policy.webResearch?[{ref:'W1',title:'网页证据',url:'https://example.com/research',searchedAt:'2026-10-17'}]:[],metadata:{policy:b.policy,selectedSources:sources.filter(s=>b.policy.scope==='current'?b.currentSourceId===s.id:b.policy.sourceIds.includes(s.id)),searchQuery:b.searchQuery,searchedAt:null,webStatus:b.policy.webResearch?'completed':'off',modelKnowledgeAllowed:b.policy.allowModelKnowledge}};
      return route.fulfill({contentType:'application/x-ndjson',body:JSON.stringify({type:'progress',message:'正在整理回答'})+'\n'+JSON.stringify({type:'result',data:result})+'\n'});
    }
    await route.fulfill({json:{code:'000000',data},headers:{'Access-Control-Allow-Origin':'*'}});
  });
  await page.goto(process.env.UI_URL||'http://127.0.0.1:3107');
  const right=page.locator('aside').last(),scope=right.getByLabel('回答资料范围'),question=right.getByLabel('问题'),send=right.getByTitle('发送问题');
  await page.waitForFunction(()=>!document.querySelector('[aria-label="回答资料范围"]')?.disabled);
  assert.equal(await scope.inputValue(),'all');assert.equal(await right.getByLabel('模型知识',{exact:true}).isChecked(),false);
  await question.fill('预算是多少');await send.click();await right.getByText('回答内容',{exact:true}).waitFor();
  assert.equal(requests[0].policy.scope,'all');
  await question.fill('@');await right.getByLabel('文档 · 产品手册.pdf',{exact:true}).check();
  await right.getByLabel('会议 · 项目会议',{exact:true}).check();await question.fill('比较资料');await send.click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="问题"]')?.disabled);
  assert.deepEqual(requests.at(-1).policy.sourceIds,['document:a','local:a']);
  await right.getByRole('button',{name:'设为默认',exact:true}).click();await right.getByText('已设为默认，将用于新对话').waitFor();
  await scope.selectOption('current');
  await page.locator('aside').first().getByRole('button',{name:'记忆与资料',exact:true}).click();
  await question.fill('当前资料的问题');assert.equal(await send.isDisabled(),true);
  await page.locator('aside').first().getByRole('button',{name:'产品手册.pdf',exact:true}).click();
  await right.getByText('当前资料：产品手册.pdf',{exact:true}).waitFor();await send.click();
  await page.waitForFunction(()=>!document.querySelector('[aria-label="问题"]')?.disabled);
  assert.equal(requests.at(-1).currentSourceId,'document:a');
  await page.locator('aside').first().getByRole('button',{name:'录音与笔记',exact:true}).click();
  await scope.selectOption('none');assert.equal(await send.isDisabled(),true);
  await right.getByLabel('模型知识',{exact:true}).check();await question.fill('解释一个概念');await send.click();
  await right.getByText('模型知识补充 · 未经资料核实',{exact:true}).waitFor();
  assert.equal(requests.at(-1).policy.scope,'none');
  await right.getByRole('button',{name:'新对话',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[aria-label="回答资料范围"]')?.value==='selected');
  assert.equal(await right.getByLabel('模型知识',{exact:true}).isChecked(),false);
  await scope.selectOption('none');await right.getByLabel('联网研究',{exact:true}).check();await question.fill('近期进展');assert.equal(await send.isDisabled(),true);
  await right.getByLabel('外发搜索词').fill('公开技术进展');await send.click();await right.getByRole('link',{name:'[W1] 网页证据'}).waitFor();
  assert.equal(requests.at(-1).searchQuery,'公开技术进展');
  await right.getByRole('button',{name:'问答设置',exact:true}).click();
  await page.getByLabel('Tavily 搜索密钥').fill('fixture-key');await page.getByRole('button',{name:'保存问答设置'}).click();await page.getByText('已保存，将用于新对话',{exact:true}).waitFor();assert.equal(key,'fixture-key');
  // Close the settings footer action.
  await page.getByRole('button',{name:'完成',exact:true}).click();
  delay=true;await question.fill('取消验证');await send.click();await right.getByTitle('停止回答').click();await right.getByText('已停止回答。',{exact:true}).waitFor();
  await page.waitForTimeout(1100);assert.equal(await right.getByText('回答内容',{exact:true}).count(),1);
  for(const width of [1080,1280,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(process.env.SCREENSHOT_DIR)await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/qa-${width}.png`});}
  assert.deepEqual(errors,[]);console.log('PASS: scopes, mixed @ selection, defaults, model-only, web query, settings, stop and responsive layout');
}finally{await browser.close();}
