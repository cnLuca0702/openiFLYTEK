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
  assert.ok(!fs.lstatSync(path.join(resources, 'node_modules')).isSymbolicLink(), 'Dependencies must be bundled');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'openiflytek-smoke-'));
  const env = {...process.env, HOME:home, ELECTRON_RUN_AS_NODE:'1', VIAIM_MEMORY_SKIP_OFFICIAL:'1'};
  let child;
  try {
    execFileSync(runtime, ['-e', "require('node:sqlite'); const c=require('@napi-rs/canvas').createCanvas(8,8); if(!c.toBuffer('image/png').length)process.exit(1)"], {cwd:resources,env,stdio:'inherit'});
    const reservation = net.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
    const port = reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
    child = spawn(runtime,[path.join(resources,'server/server.js')],{cwd:resources,env:{...env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
    let logs='';child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
    let ready=false;
    for(let i=0;i<100;i++) {
      if(child.exitCode!==null)throw new Error(`Packaged backend exited: ${logs}`);
      try {const res=await fetch(`http://127.0.0.1:${port}/api/memory/status`);if(res.ok){assert.equal((await res.json()).data.available,true);ready=true;break;}}catch (_){}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    assert.ok(ready,`Packaged backend did not start: ${logs}`);
    const response=await fetch(`http://127.0.0.1:${port}/api/documents?name=smoke.txt`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'打包运行验证资料'});
    assert.equal(response.status,200);
    const document=(await response.json()).data;
    const original=await fetch(`http://127.0.0.1:${port}/api/documents/${encodeURIComponent(document.id)}/file/original`);
    assert.equal(await original.text(),'打包运行验证资料');
    console.log('Packaged runtime, SQLite, ARM native canvas, memory API and document upload: OK');
  } finally {
    if(child && child.exitCode===null){child.kill();await once(child,'exit');}
    fs.rmSync(home,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
