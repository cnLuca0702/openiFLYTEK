import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const listen = async (server) => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return server.address().port;
};

test('HTTP: 会议/文档/办公本接口的只读保护、校验与错误路径', { timeout: 60000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'viaim-api-'));
  const configDir = path.join(home, 'Library/Application Support/VIAIM Studio/config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'llm.json'), JSON.stringify({
    provider: 'custom',
    providers: { custom: { apiKey: 'fixture-key-123456', model: 'fixture', baseUrl: 'http://127.0.0.1:1/v1' } },
  }));

  const reservation = http.createServer();
  const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));

  let log = '';
  const child = spawn(process.execPath, ['server/server.js'], {
    env: { ...process.env, HOME: home, PORT: String(port), VIAIM_MEMORY_SKIP_OFFICIAL: '1', VIAIM_DB_PATH: path.join(home, 'missing-official.db') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => { log += d; });
  child.stderr.on('data', (d) => { log += d; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    fs.rmSync(home, { recursive: true, force: true });
  });

  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/memory/status`)).ok) { ready = true; break; } } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(ready, `后端未就绪:\n${log}`);
  const health = await (await fetch(`${base}/api/health`)).json();
  assert.equal(health.app, 'OpeniFLYTEK');
  assert.equal(health.version, JSON.parse(fs.readFileSync('package.json', 'utf8')).version);
  assert.ok(health.capabilities.includes('memory-panorama'));
  const missingApi = await fetch(`${base}/api/unknown-route`);
  assert.equal(missingApi.status, 404);
  assert.equal((await missingApi.json()).code, 'API_NOT_FOUND');


  const json = async (method, url, body) => {
    const response = await fetch(base + url, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
  };

  const upload = async (name, bytes, replaces) => {
    const response = await fetch(`${base}/api/documents?name=${encodeURIComponent(name)}${replaces ? `&replaces=${encodeURIComponent(replaces)}` : ''}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: bytes,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null };
  };

  await t.test('记忆与文档模块可用，且不因缺少官方库而降级失败', async () => {
    const status = await json('GET', '/api/memory/status');
    assert.equal(status.status, 200);
    assert.equal(status.body.code, '000000');
    assert.equal(status.body.data.available, true);
    assert.equal((await json('GET', '/api/documents')).body.data.length, 0);
    const panorama=await json('GET','/api/memory/panorama');
    assert.equal(panorama.status,200);assert.equal(panorama.body.data.totals.sources,0);
    const insights = await json('GET', '/api/memory/insights');
    assert.equal(insights.status, 200);
    assert.deepEqual(Object.keys(insights.body.data).sort(), ['changes', 'citations', 'followups', 'pending']);
  });

  await t.test('录音落库后可在项目存储内读取，删除后记忆同步失效', async () => {
    const audio = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(64, 1)]);
    const created = await json('POST', '/api/meetings/record', {
      title: '接口测试会议',
      durationMs: 8000,
      sentences: [{ speaker: '我', startTimeMs: 0, endTimeMs: 4000, text: '这条内容来自录音接口。' }],
      audioBase64: `data:audio/webm;codecs=opus;base64,${audio.toString('base64')}`,
    });
    assert.equal(created.status, 200);
    const meeting = created.body.data;
    assert.match(meeting.id, /^local:\d+$/);
    assert.equal(meeting.sentences.length, 1);
    assert.equal(meeting.hasAudio, true);

    const detail = await json('GET', `/api/meetings/${encodeURIComponent(meeting.id)}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.data.title, '接口测试会议');

    const audio206 = await fetch(`${base}/api/meetings/${encodeURIComponent(meeting.id)}/audio`, { headers: { Range: 'bytes=0-3' } });
    assert.equal(audio206.status, 206);
    assert.equal(audio206.headers.get('content-range'), 'bytes 0-3/68');

    const list = await json('GET', '/api/meetings');
    assert.equal(list.status, 200);
    assert.ok(list.body.data.some((m) => m.id === meeting.id), '官方库缺失时项目会议仍可见');
    assert.deepEqual(list.body.sources.viaim, {available:false, code:'VIAIM_DB_MISSING'});
    assert.equal((await json('GET', '/api/meetings?includeLegacy=1')).status,200);


    const panorama=await json('GET','/api/memory/panorama');
    assert.equal(panorama.status,200);assert.ok(panorama.body.data.sources.some(s=>s.id===meeting.id));
    const removed = await json('DELETE', `/api/meetings/${encodeURIComponent(meeting.id)}`);
    assert.equal(removed.status, 200);
    assert.equal(removed.body.data.success, true);
    assert.ok(!(await json('GET','/api/memory/panorama')).body.data.sources.some(s=>s.id===meeting.id));
    assert.equal((await json('GET', `/api/meetings/${encodeURIComponent(meeting.id)}`)).status, 404);
    assert.equal((await json('DELETE', `/api/meetings/${encodeURIComponent(meeting.id)}`)).status, 500, '重复删除应报错而不是静默成功');
  });

  await t.test('官方 VIAIM 数据只读：待办与删除均被拒绝', async () => {
    for (const [method, url] of [
      ['POST', '/api/meetings/viaim-1/todos/t1/toggle'],
      ['DELETE', '/api/meetings/viaim-1'],
    ]) {
      const response = await json(method, url, method === 'POST' ? {} : undefined);
      assert.equal(response.status, 409);
      assert.equal(response.body.code, 'VIAIM_READ_ONLY');
    }
    const audio = await fetch(`${base}/api/meetings/viaim-1/audio`);
    assert.equal(audio.status, 404, '非项目会议不得通过项目音频接口读取');
  });

  await t.test('文档上传校验：类型、大小、空文件与替换目标', async () => {
    const badType = await upload('payload.exe', Buffer.from('MZ'));
    assert.equal(badType.status, 400);
    assert.equal(badType.body.code, 'DOCUMENT_UPLOAD_FAILED');
    assert.match(badType.body.desc, /不支持的文档类型/);

    const empty = await upload('empty.txt', Buffer.alloc(0));
    assert.equal(empty.status, 400);
    assert.match(empty.body.desc, /文件不能为空/);

    const noName = await upload('', Buffer.from('内容'));
    assert.equal(noName.status, 400);

    const badReplaces = await upload('a.txt', Buffer.from('内容'), 'document:' + '0'.repeat(64));
    assert.equal(badReplaces.status, 400);
    assert.match(badReplaces.body.desc, /待更新来源不存在或尚未就绪/);

    const ok = await upload('会议记录.txt', Buffer.from('晨星项目一期按期上线，二期顺延一个月。'));
    assert.equal(ok.status, 200);
    assert.match(ok.body.data.id, /^document:[a-f0-9]{64}$/);
    assert.equal(ok.body.data.name, '会议记录.txt', '文件名应去掉路径成分');

    const again = await upload('另一个名字.txt', Buffer.from('晨星项目一期按期上线，二期顺延一个月。'));
    assert.equal(again.body.data.id, ok.body.data.id, '相同内容应按散列去重');

    const pathName = await upload('../../etc/passwd.txt', Buffer.from('x'));
    assert.equal(pathName.status, 200, '上传名中的路径成分应被剥离而不是拒绝');
    assert.equal(pathName.body.data.name, 'passwd.txt');

    const escaped = await fetch(`${base}/api/documents/${encodeURIComponent(ok.body.data.id)}/file/../../notebook.db`);
    assert.equal(escaped.status, 404, '不得通过 file 接口读取存储目录外的文件');

    assert.equal((await json('GET', `/api/documents/document:${'0'.repeat(64)}`)).status, 404);
    const original = await fetch(`${base}/api/documents/${encodeURIComponent(ok.body.data.id)}/file/original`);
    assert.equal(original.status, 200);
    assert.equal(original.headers.get('x-content-type-options'), 'nosniff');
    const disposition = decodeURIComponent(original.headers.get('content-disposition') || '');
    assert.match(disposition, /attachment/, '原件下载必须作为附件返回');
    assert.match(disposition, /会议记录\.txt/);
    assert.equal(await original.text(), '晨星项目一期按期上线，二期顺延一个月。');
  });

  await t.test('办公本未登录时返回 401 而非崩溃，音频未缓存返回 409', async () => {
    const notes = await json('GET', '/api/notebook/notes');
    assert.equal(notes.status, 200);
    assert.equal(notes.body.code, '000000');
    assert.equal(notes.body.data.authenticated, false, '未登录时应显式声明未认证');
    assert.deepEqual(notes.body.data.list, []);

    const audio = await json('GET', '/api/notebook/notes/remote-1/audio');
    assert.equal(audio.status, 409);
    assert.equal(audio.body.code, 'AUDIO_NOT_READY');
    assert.equal(audio.body.data.state, 'not_downloaded');

    const importResult = await json('POST', '/api/notebook/notes/remote-1/import', {});
    assert.ok([409, 500].includes(importResult.status), '未缓存录音不得被导入');

    assert.equal((await json('POST', '/api/notebook/token', {})).status, 400);
    assert.equal((await json('POST', '/api/notebook/login', { mobile: '1' })).status, 400);
    assert.equal((await json('POST', '/api/notebook/recycle/recover', { noteIds: [] })).status, 400);
    const legacy = await json('GET', '/api/notebook/legacy-imports');
    assert.equal(legacy.status,200);
    assert.deepEqual(legacy.body.data,[]);
    assert.equal(legacy.body.sources.viaim.code,'VIAIM_DB_MISSING');
  });

  await t.test('大模型配置接口只回传脱敏信息', async () => {
    const config = await json('GET', '/api/llm/config');
    assert.equal(config.status, 200);
    assert.ok(!config.body.data.providers.custom.apiKey, '不得返回明文密钥');
    assert.equal(config.body.data.providers.custom.apiKeySet, true);
    assert.match(config.body.data.providers.custom.apiKeyMasked, /••••/);
    assert.equal(config.body.data.chatgpt.loggedIn, false);
    assert.ok(config.body.data.asr.mode);

    const saved = await json('PUT', '/api/llm/config', {
      provider: 'custom',
      providerConfig: { apiKey: 'rotated-key-987654', model: 'fixture2' },
    });
    assert.equal(saved.status, 200);
    const after = await json('GET', '/api/llm/config');
    assert.equal(after.body.data.providers.custom.model, 'fixture2');
    assert.ok(!after.body.data.providers.custom.apiKey);
    assert.equal(after.body.data.providers.custom.apiKeyMasked, 'rota••••7654');
    assert.equal(after.body.data.providers.custom.baseUrl, 'http://127.0.0.1:1/v1', '未提交的字段应保留');

    const providers = await json('GET', '/api/llm/providers');
    assert.ok(providers.body.data.some((p) => p.id === 'custom'));
    assert.ok(!JSON.stringify(providers.body).includes('apiKey'));
  });

  await t.test('问答与纪要在参数缺失或模型不可用时返回明确错误码', async () => {
    assert.equal((await json('POST', '/api/ai/chat', { question: '' })).status, 400);
    assert.equal((await json('POST', '/api/ai/chat', { meetingIds: 'x'.repeat(9000) })).status, 400);
    const missing = await json('POST', '/api/meetings/missing-id/generate-ai', {});
    assert.equal(missing.status,404);
    assert.equal(missing.body.code,'404');
    assert.equal((await json('GET','/api/meetings/missing-id')).status,404);

    const chat = await json('POST', '/api/ai/chat', { question: '项目预算是多少' });
    assert.ok([200, 404, 500, 503].includes(chat.status), `异常状态 ${chat.status}`);
    if (chat.status !== 200) assert.ok(chat.body.desc, '错误响应必须带可读说明');
    const scoped = await json('POST', '/api/ai/chat', { question: '结论是什么', meetingIds: ['viaim-1'] });
    assert.equal(scoped.status, 200);
    assert.match(scoped.body.data.answer, /未找到|无法读取|不存在/, '范围指向不可读会议时必须如实说明而非编造');
    assert.deepEqual(scoped.body.data.citations, []);
  });

  await t.test('用户画像接口在缺少官方配置时仍返回兜底数据', async () => {
    const profile = await json('GET', '/api/user/profile');
    assert.equal(profile.status, 200);
    assert.ok(profile.body.data && typeof profile.body.data === 'object');
  });
  await t.test('官方库损坏仍保留项目列表，但详情故障不会伪装成404', async () => {
    const created=await json('POST','/api/meetings/record',{title:'官方库故障时的项目会议',durationMs:1,sentences:[{text:'项目资料仍可读取。'}]});
    assert.equal(created.status,200);
    fs.writeFileSync(path.join(home,'missing-official.db'),'not a sqlite database');
    const list=await json('GET','/api/meetings');
    assert.equal(list.status,200);
    assert.equal(list.body.sources.viaim.code,'VIAIM_DB_UNAVAILABLE');
    assert.ok(list.body.data.some(m=>m.id===created.body.data.id));
    assert.equal((await json('GET',`/api/meetings/${encodeURIComponent(created.body.data.id)}`)).status,200);
    assert.equal((await json('POST','/api/meetings/unknown/generate-ai',{})).status,500);
  });

});