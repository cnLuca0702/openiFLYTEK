// Isolated UI regression with mocked APIs; no real meetings or models are used.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1080,height:900}}),errors=[],calls=[];
  page.on('pageerror',e=>errors.push(e.message));
  const make=(id,title)=>({id,title,source:'local',category:'会议',createdAt:'2026-10-17',duration:'00:01',status:'completed',sentences:[{id:'s1',speaker:'张三',time:'00:00',text:'讨论方案'}],aiSummary:{generated:false,abstract:'',topics:[],todos:[]}});
  const a=make('meeting:a','方案评审'),b=make('meeting:b','另一次会议');
  const result={generated:true,title:'评审纪要',abstract:'确认实施方案',topics:['上线安排'],summaryFull:'完整会议结论',todos:[{id:'todo1',task:'准备材料',owner:'张三',done:false}]};
  const citation={ref:1,chunkId:1,meetingId:b.id,version:'v1',sourceType:'meeting',pages:[],title:b.title,occurredAt:'2026-10-16',startMs:0,endMs:1000,excerpt:'历史依据',sentenceIds:['s1']};
  let fail=false,delayGeneration=0,delayTodo=0;
  await page.route('**/api/**',async route=>{
    const p=decodeURIComponent(new URL(route.request().url()).pathname);let data={};
    if(p==='/api/meetings')data=[a,b];
    else if(p.endsWith('/generate-ai')){
      calls.push({p,body:route.request().postDataJSON()});
      if(delayGeneration)await new Promise(r=>setTimeout(r,delayGeneration));
      if(fail)return route.fulfill({json:{code:'FAILED',desc:'模拟生成失败'}});
      const m=p.includes(a.id)?a:b;m.aiSummary=structuredClone(result);data=m.aiSummary;
    }
    else if(p.includes('/todos/')){
      if(delayTodo)await new Promise(r=>setTimeout(r,delayTodo));
      a.aiSummary.todos[0].done=!a.aiSummary.todos[0].done;data=a.aiSummary.todos;
    }
    else if(p===`/api/meetings/${a.id}`)data=a;
    else if(p===`/api/meetings/${b.id}`)data=b;
    else if(p==='/api/llm/config')data={providers:{},chatgpt:{loggedIn:false}};
    else if(p==='/api/llm/providers')data=[];
    else if(p.startsWith('/api/memory/related'))data=[citation];
    else if(p.startsWith('/api/memory/evidence'))data=citation;
    else if(p==='/api/memory/insights')data={followups:[{id:'f1',item:'历史交付事项',status:'completed',owners:['张三'],dueDate:'',history:[{id:'h1',quote:'已有交付凭据',chunkId:1}]}],changes:[],citations:[citation],pending:0};
    await route.fulfill({json:{code:'000000',data}});
  });
  await page.goto(process.env.UI_URL||'http://127.0.0.1:3107');
  const main=page.locator('main'),left=page.locator('aside').first();
  await main.getByRole('button',{name:'会议纪要',exact:true}).click();
  assert.equal(await page.getByText('AI 会议大脑',{exact:true}).count(),0);
  await main.getByRole('button',{name:'生成会议纪要',exact:true}).click();
  await main.getByText('确认实施方案',{exact:true}).waitFor();
  assert.equal(calls[0].body.force,false);
  await main.getByRole('checkbox',{name:'准备材料'}).click();
  await page.waitForFunction(()=>document.querySelector('main input[type=checkbox]')?.checked);
  await main.getByText('相关记忆与历史跟进',{exact:true}).click();
  await main.getByText('历史交付事项 · 有完成证据',{exact:true}).click();
  await main.getByText('已有交付凭据',{exact:false}).waitFor();
  await main.getByText(/另一次会议 ·/).click();
  await main.getByText('历史依据',{exact:true}).waitFor();
  await main.getByRole('button',{name:'查看来源',exact:true}).click();
  await main.getByText(b.title,{exact:true}).waitFor();
  // Sidebar menu opens the summary in the middle pane.
  await left.getByLabel('方案评审的更多操作').click();
  await left.getByRole('button',{name:'查看会议纪要',exact:true}).click();
  await main.getByText('确认实施方案',{exact:true}).waitFor();
  fail=true;
  await main.getByRole('button',{name:'重新生成纪要',exact:true}).click();
  await main.getByRole('alert').filter({hasText:'模拟生成失败'}).waitFor();
  assert.equal(calls.at(-1).body.force,true);
  fail=false;delayGeneration=500;
  await main.getByRole('button',{name:'重新生成纪要',exact:true}).click();
  await left.getByRole('heading',{name:b.title,exact:true}).click();
  await main.getByRole('button',{name:'会议纪要',exact:true}).click();
  assert.equal(await main.getByRole('button',{name:'生成会议纪要',exact:true}).isDisabled(),true);
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('main button')).find(b=>b.textContent==='生成会议纪要')?.disabled);
  assert.equal(await main.getByText('确认实施方案',{exact:true}).count(),0);
  await left.getByLabel('方案评审的更多操作').click();
  await left.getByRole('button',{name:'查看会议纪要',exact:true}).click();
  await main.getByText('确认实施方案',{exact:true}).waitFor();
  delayTodo=400;
  await main.getByRole('checkbox',{name:'准备材料'}).click();
  await left.getByRole('heading',{name:b.title,exact:true}).click();
  await page.waitForTimeout(500);
  await main.getByText(b.title,{exact:true}).waitFor();
  assert.equal(await main.getByText('确认实施方案',{exact:true}).count(),0);
  // Sidebar generation targets the requested meeting, not the previous selection.
  await left.getByLabel('另一次会议的更多操作').click();
  await left.getByRole('button',{name:'生成会议纪要',exact:true}).click();
  await main.getByText('确认实施方案',{exact:true}).waitFor();
  assert.equal(calls.at(-1).p,`/api/meetings/${b.id}/generate-ai`);
  for(const width of [1080,1280,1440]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    const button=await main.getByRole('button',{name:'重新生成纪要',exact:true}).boundingBox();
    const area=await main.boundingBox();assert.ok(button.x>=area.x&&button.x+button.width<=area.x+area.width);
    if(process.env.SCREENSHOT_DIR)await page.screenshot({path:`${process.env.SCREENSHOT_DIR}/meeting-summary-${width}.png`});
  }
  assert.deepEqual(errors,[]);
  console.log('PASS: middle summary, todos, history source, sidebar actions, retry, meeting switching, 1080/1280/1440 layouts');
} finally {await browser.close();}
