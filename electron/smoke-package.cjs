// Validate the shipped runtime using an isolated HOME and an ephemeral HTTP port.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const {spawn, execFileSync} = require('node:child_process');
const {once} = require('node:events');
const assert = require('node:assert/strict');
(async () => {
  const bundle = path.resolve(process.argv[2] || path.join(__dirname, '../dist_mac/OpeniFLYTEK.app'));
  const runtime = path.join(bundle, 'Contents/MacOS/OpeniFLYTEK');
  const resources = path.join(bundle, 'Contents/Resources/app');
  const metadata=JSON.parse(execFileSync('plutil',['-convert','json','-o','-',path.join(bundle,'Contents/Info.plist')],{encoding:'utf8'}));
  const release=require('../package.json');
  for(const field of ['CFBundleName','CFBundleDisplayName','CFBundleExecutable'])assert.equal(metadata[field],release.productName);
  for(const field of ['CFBundleVersion','CFBundleShortVersionString'])assert.equal(metadata[field],release.version);
  assert.equal(metadata.CFBundleIdentifier,'com.openiflytek.app');
  assert.equal(metadata.CFBundleIconFile,'icon.icns');
  assert.deepEqual(fs.readFileSync(path.join(bundle,'Contents/Resources/icon.icns')),fs.readFileSync(path.join(__dirname,'resources/icon.icns')));
  assert.deepEqual(fs.readFileSync(path.join(resources,'electron/resources/icon.png')),fs.readFileSync(path.join(__dirname,'resources/icon.png')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(resources,'package.json'))).version,release.version);
  console.log('Application name, version and current release icons: OK');
  assert.ok(!fs.lstatSync(path.join(resources, 'node_modules')).isSymbolicLink(), 'Dependencies must be bundled');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openiflytek-smoke-'));
  const env = {...process.env, HOME:home, ELECTRON_RUN_AS_NODE:'1', VIAIM_MEMORY_SKIP_OFFICIAL:'1', VIAIM_DB_PATH:path.join(home,'missing-official.db')};
  let child;
  try {
    execFileSync(runtime, ['-e', "require('node:sqlite'); const c=require('@napi-rs/canvas').createCanvas(8,8); if(!c.toBuffer('image/png').length)process.exit(1); import('./server/summary_service.js').then(({buildTranscript})=>require('node:assert/strict').equal(buildTranscript({sentences:[{text:'📌 重点标记点 [00:23]'},{text:'00:25'},{text:'有效内容'}]}),'有效内容'))"], {cwd:resources,env,stdio:'inherit'});
    const reservation = net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
    const port = reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    child = spawn(runtime,[path.join(resources,'server/server.js')],{cwd:resources,env:{...env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
    let logs='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
    let ready=false;
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null)throw new Error(`Packaged backend exited: ${logs}`);
      try {const res=await fetch(`http://127.0.0.1:${port}/api/memory/status`);if(res.ok){const status=(await res.json()).data;assert.equal(status.available,true);assert.equal(status.semantic.state,'unconfigured');ready=true;break;}}catch (_){}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,`Packaged backend did not start: ${logs}`);
    const response=await fetch(`http://127.0.0.1:${port}/api/documents?name=smoke.txt`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'打包运行验证资料'});
    assert.equal(response.status,200);
    const document=(await response.json()).data;
    const original=await fetch(`http://127.0.0.1:${port}/api/documents/${encodeURIComponent(document.id)}/file/original`);
    assert.equal(await original.text(),'打包运行验证资料');
    const base = `http://127.0.0.1:${port}`;
    const overview=await fetch(`${base}/api/memory/panorama`);
    assert.equal(overview.status,200);assert.equal((await overview.json()).data.totals.sources,0);
    const audio = Buffer.from('OggS123456789');
    const recording = await fetch(`${base}/api/meetings/record`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:'打包回归验证',durationMs:1000,sentences:[{text:'有效内容'}],audioBase64:'data:audio/ogg;base64,'+audio.toString('base64')})});
    assert.equal(recording.status,200);
    const meeting = (await recording.json()).data;
    const list = await (await fetch(`${base}/api/meetings`)).json();
    assert.equal(list.sources.viaim.code,'VIAIM_DB_MISSING');
    assert.ok(list.data.some(m=>m.id===meeting.id));
    const panorama=(await (await fetch(`${base}/api/memory/panorama`)).json()).data;
    assert.ok(panorama.sources.some(s=>s.id===meeting.id));
    assert.equal(panorama.totals.meetings,1);
    const suffix = await fetch(`${base}/api/meetings/${encodeURIComponent(meeting.id)}/audio`,{headers:{Range:'bytes=-4'}});
    assert.equal(suffix.status,206);
    assert.deepEqual(Buffer.from(await suffix.arrayBuffer()),audio.subarray(-4));
    const missing = await fetch(`${base}/api/meetings/missing/generate-ai`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(missing.status,404);
    console.log('Packaged runtime, knowledge panorama, documents, transcript filtering, missing official DB and suffix Range: OK');
  } finally {
    if(child && child.exitCode===null){child.kill();await once(child,'exit');}
    fs.rmSync(home,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
