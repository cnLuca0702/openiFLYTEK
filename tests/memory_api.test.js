import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const listen = async (server) => { server.listen(0, '127.0.0.1'); await once(server, 'listening'); return server.address().port; };
test('HTTP: recording auto-capture, unscoped chat, citation validation and deletion', { timeout: 30000 }, async (t) => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'viaim-memory-api-'));
  const model = http.createServer(async (req, res) => {
    let body = ''; for await (const part of req) body += part;
    const input = JSON.parse(body);
    const extraction = input.messages[0].content.includes('提取可追溯');
    const knowledge = input.messages[0].content.includes('知识单元');
    const content = knowledge ? {overview:'科研资料',units:[{type:'concept',question:'科研预算',answer:'八万元',basis:'fact',pages:[1]}]} : extraction ? { facts: [] } : { answer: '科研项目预算为八万元。[1]', citations: [1] };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ model: 'fixture', choices: [{ message: { content: JSON.stringify(content) } }] }));
  });
  const modelPort = await listen(model);
  const reservation = http.createServer(); const port = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const configDir = path.join(home, 'Library/Application Support/VIAIM Studio/config');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(path.join(configDir, 'llm.json'), JSON.stringify({ provider: 'custom', providers: { custom: { apiKey: 'fixture', model: 'fixture', baseUrl: `http://127.0.0.1:${modelPort}` } } }));
  const child = spawn(process.execPath, ['server/server.js'], { env: { ...process.env, HOME: home, PORT: String(port), VIAIM_MEMORY_SKIP_OFFICIAL: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; child.stdout.on('data', (b) => { log += b; }); child.stderr.on('data', (b) => { log += b; });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    await new Promise((resolve) => model.close(resolve));
    fs.rmSync(home, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(`${base}/api/memory/status`)).ok) { ready = true; break; } } catch (_) {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(ready, log);
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const created = await (await post('/api/meetings/record', { title: '科研项目', durationMs: 50000,
    sentences: [{ speaker: '张老师', text: '科研项目预算为八万元。', startTimeMs: 32000, endTimeMs: 45000 }] })).json();
  assert.equal(created.code, '000000');
  const answer = await (await post('/api/ai/chat', { question: '科研项目预算是多少', meetingIds: [] })).json();
  assert.equal(answer.code, '000000', JSON.stringify(answer));
  assert.equal(answer.data.citations[0].meetingId, created.data.id);
  const citation = answer.data.citations[0];
  const evidenceUrl = `/api/memory/evidence/${citation.chunkId}?version=${citation.version}`;
  assert.equal((await fetch(base + evidenceUrl)).status, 200);
  assert.equal((await fetch(`${base}/api/memory/evidence/${citation.chunkId}?version=wrong`)).status, 409);
  const deleted = await fetch(`${base}/api/meetings/${encodeURIComponent(created.data.id)}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await fetch(base + evidenceUrl)).status, 409);
  const missing = await (await post('/api/ai/chat', { question: '科研项目预算' })).json();
  assert.deepEqual(missing.data.citations, []);
  const upload=await fetch(`${base}/api/documents?name=${encodeURIComponent('科研.txt')}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:'科研项目预算为八万元。'});
  assert.equal(upload.status,200);const document=(await upload.json()).data;
  let doc;
  for(let i=0;i<120;i++) {doc=(await(await fetch(`${base}/api/documents/${encodeURIComponent(document.id)}`)).json()).data;if(doc.status==='ready')break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(doc.status,'ready',JSON.stringify(doc));
  const docAnswer=await(await post('/api/ai/chat',{question:'科研项目预算'})).json();
  assert.equal(docAnswer.data.citations[0].sourceType,'document');
  assert.deepEqual(docAnswer.data.citations[0].pages,[1]);
  const download=await fetch(`${base}/api/documents/${encodeURIComponent(document.id)}/file/original`);assert.equal(await download.text(),'科研项目预算为八万元。');
  assert.equal((await fetch(`${base}/api/memory/insights`)).status,200);
  const documentCitation=docAnswer.data.citations[0];
  await fetch(`${base}/api/documents/${encodeURIComponent(document.id)}`,{method:'DELETE'});
  assert.equal((await fetch(`${base}/api/memory/evidence/${documentCitation.chunkId}?version=${documentCitation.version}`)).status,409);
  assert.equal((await fetch(`${base}/api/documents/${encodeURIComponent(document.id)}/file/original`)).status,404);

});
