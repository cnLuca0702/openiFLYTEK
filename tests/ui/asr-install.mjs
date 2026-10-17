// Mock IPC + HTTP only: this test never installs system packages or downloads models.
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage();let ready=false;
  await page.route('**/api/**',route=>{
    const p=new URL(route.request().url()).pathname;
    const data=p==='/api/asr/status'?{local:{available:ready,cli:ready,model:ready?'ggml-base.bin':'',ffmpeg:ready},online:{available:false}}:p==='/api/llm/config'?{asr:{mode:'local',priority:'local'},providers:{},chatgpt:{loggedIn:false}}:[];
    return route.fulfill({json:{code:'000000',data}});
  });
  await page.goto(process.env.UI_URL||'http://127.0.0.1:3107');
  await page.evaluate(async()=>{
    const {default:React}=await import('/node_modules/.vite/deps/react.js');
    const {default:{createRoot}}=await import('/node_modules/.vite/deps/react-dom_client.js');
    const {AsrSettingsPanel}=await import('/src/components/AsrSettingsPanel.tsx');
    window.installCalls=0;window.installStatus={state:'idle',running:false,message:''};
    window.electronAPI={platform:'darwin',installLocalAsr:async()=>{window.installCalls++;return window.installStatus={state:'dependencies',running:true,message:'正在安装识别引擎与音频工具…'};},localAsrInstallStatus:async()=>window.installStatus,openAsrInstallLog:async()=>''};
    const host=document.createElement('section');host.id='asr-test';document.body.append(host);createRoot(host).render(React.createElement(AsrSettingsPanel));
  });
  const panel=page.locator('#asr-test');
  await panel.getByRole('button',{name:'一键安装本地转写'}).click();
  assert.equal(await panel.getByRole('button',{name:'正在安装…'}).isDisabled(),true);
  assert.equal(await page.evaluate(()=>window.installCalls),1);
  await page.evaluate(()=>window.installStatus={state:'model',running:true,message:'正在下载模型',downloadedBytes:100,totalBytes:200});
  await panel.getByRole('progressbar',{name:'模型下载进度'}).waitFor();
  await page.evaluate(()=>window.installStatus={state:'error',running:false,message:'安装未完成'});
  await panel.getByRole('button',{name:'重试安装'}).click();
  assert.equal(await page.evaluate(()=>window.installCalls),2);
  ready=true;
  await page.evaluate(()=>window.installStatus={state:'complete',running:false,message:'本地语音组件安装完成'});
  await panel.getByText('已就绪 · ggml-base.bin',{exact:true}).waitFor();
  assert.equal(await panel.getByRole('button',{name:'一键安装本地转写'}).count(),0);
  console.log('ASR install UI: one-click launch, duplicate prevention, progress, retry and automatic availability refresh passed.');
}finally{await browser.close();}
