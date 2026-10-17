// Isolated component harness: no microphone, backend or user data.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1080,height:700}});
  await page.route('**/api/**', route => route.fulfill({status:503,json:{code:'TEST_ISOLATION',desc:'组件测试隔离'}}));
  await page.goto(process.env.UI_URL||'http://127.0.0.1:3107');
  await page.evaluate(async()=>{
    const {default: React}=await import('/node_modules/.vite/deps/react.js');
    const {default: {createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
    const {SuspendQuickWindow}=await import('/src/components/SuspendQuickWindow.tsx');
    localStorage.setItem('viaim-quick-capsule-pos',JSON.stringify({x:1900,y:1100}));
    const host=document.createElement('div');document.body.append(host);
    window.capsuleEvents=[];
    function Harness(){
      const [open,setOpen]=React.useState(true),[recording,setRecording]=React.useState(false),[paused,setPaused]=React.useState(false);
      return React.createElement(React.Fragment,null,
        React.createElement('button',{onClick:()=>setOpen(true)},'测试重新打开'),
        React.createElement(SuspendQuickWindow,{isOpen:open,onClose:()=>setOpen(false),isRecording:recording,isPaused:paused,
          onStartRecord:()=>{setRecording(true);window.capsuleEvents.push('start');},onPauseResume:()=>setPaused(v=>!v),
          onStopRecording:()=>{setRecording(false);window.capsuleEvents.push('stop');},onFinishAndSummarize:()=>{},onAddBookmark:()=>window.capsuleEvents.push('bookmark'),
          recordingDuration:'00:12',latestSentence:'测试文字',analyser:null,autoSummarize:true}));
    }
    createRoot(host).render(React.createElement(Harness));
  });
  const capsule=page.getByRole('region',{name:'快捷录音胶囊'});
  await capsule.waitFor();
  const inside=async()=>{await page.waitForTimeout(300);const b=await capsule.boundingBox(),v=page.viewportSize();assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=v.width&&b.y+b.height<=v.height,JSON.stringify(b));};
  await inside();
  await capsule.getByTitle('开始录音',{exact:true}).click();
  await capsule.getByTitle('展开快捷操作').click();await inside();
  await capsule.getByTitle('暂停录音',{exact:true}).click();
  await capsule.getByTitle('继续录音',{exact:true}).waitFor();
  await capsule.getByTitle('继续录音',{exact:true}).click();
  await capsule.getByTitle('在当前时刻标记重点').click();
  await capsule.getByTitle('收起胶囊（不停录）').click();
  assert.equal(await capsule.count(),0);
  assert.deepEqual(await page.evaluate(()=>window.capsuleEvents),['start','bookmark']);
  await page.getByRole('button',{name:'测试重新打开'}).click();
  await page.setViewportSize({width:800,height:500});await inside();
  await capsule.getByTitle('停止录音',{exact:true}).click();
  await capsule.getByTitle('开始录音',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>window.capsuleEvents),['start','bookmark','stop']);
  console.log('Quick capsule: restored position, expansion, resize, pause/resume, bookmark, hide without stopping and explicit stop passed.');
}finally{await browser.close();}
