import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {EventEmitter} from 'node:events';
import installer from '../electron/asr-installer.cjs';

test('本地安装任务：重复点击复用、重开恢复、异常退出与平台限制', t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'asr-task-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  let launches=0;
  const launch=()=>{launches++;const child=new EventEmitter();child.unref=()=>{};return child;};
  const manager=installer.createAsrInstaller({home,platform:'darwin',launch});
  assert.equal(manager.status().state,'idle');
  assert.equal(manager.start().running,true);
  manager.start();assert.equal(launches,1);
  const job=path.dirname(manager.logPath());
  fs.writeFileSync(path.join(job,'pid'),String(process.pid));
  fs.writeFileSync(path.join(job,'stage'),'model');
  assert.equal(installer.createAsrInstaller({home,platform:'darwin',launch}).status().state,'model');
  fs.writeFileSync(path.join(job,'stage'),'error');
  assert.equal(manager.status().running,false);
  manager.start();assert.equal(launches,2);
  assert.throws(()=>installer.createAsrInstaller({home,platform:'linux',launch}).start(),/macOS/);
});

test('安装脚本：成功验证后发布模型；损坏下载保留旧文件，支持重试与带引号路径', t => {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),"asr install '"));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const job=path.join(home,'job'),bin=path.join(home,'bin');fs.mkdirSync(job);fs.mkdirSync(bin);
  const writeTool=(name,body)=>fs.writeFileSync(path.join(bin,name),'#!/bin/bash\n'+body,{mode:0o700});
  writeTool('brew','exit 0');writeTool('ffmpeg','exit 0');writeTool('whisper-cli','exit 0');
  const payload='fixture model';const sha=createHash('sha256').update(payload).digest('hex');
  writeTool('curl','for last; do :; done\nprintf "fixture model" > "$last"');
  let script=installer.installerScript(job,home)
    .replace('export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin',`export PATH=${JSON.stringify(bin)}:/usr/bin:/bin`)
    .replaceAll('/opt/homebrew/bin/brew', "'"+path.join(bin,'brew').replaceAll("'","'\\''")+"'")
    .replaceAll('/usr/bin/curl', "'"+path.join(bin,'curl').replaceAll("'","'\\''")+"'")
    .replaceAll(installer.MODEL_SHA,sha);
  const file=path.join(job,'install.command');fs.writeFileSync(file,script);
  let result=spawnSync('/bin/bash',[file],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr+result.stdout);
  assert.equal(fs.readFileSync(path.join(job,'stage'),'utf8'),'complete');
  const model=path.join(home,'.cache/whisper/ggml-base.bin');assert.equal(fs.readFileSync(model,'utf8'),payload);
  fs.writeFileSync(model,'previous model');writeTool('curl','for last; do :; done\nprintf "bad download" > "$last"');
  result=spawnSync('/bin/bash',[file],{encoding:'utf8'});
  assert.notEqual(result.status,0);
  assert.equal(fs.readFileSync(path.join(job,'stage'),'utf8'),'error');
  assert.equal(fs.readFileSync(model,'utf8'),'previous model');
  assert.equal(fs.readFileSync(path.join(job,'model.partial'),'utf8'),'bad download');
});
