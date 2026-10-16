import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';

import {
  safePathSegment,
  getRelativeNotebookPath,
  resolveNotebookPath,
  NOTEBOOK_STORE_DIR,
  NOTEBOOK_CACHE_DIR,
  NOTEBOOK_RECORDING_DIR,
  NOTEBOOK_BACKUP_DIR,
  NOTEBOOK_DB_PATH,
} from '../server/storage_paths.js';
import { mediaContentType, streamLocalMedia } from '../server/media_stream.js';

test('项目存储目录全部位于 VIAIM Studio 应用数据目录下', () => {
  for (const dir of [NOTEBOOK_STORE_DIR, NOTEBOOK_CACHE_DIR, NOTEBOOK_RECORDING_DIR, NOTEBOOK_BACKUP_DIR, NOTEBOOK_DB_PATH]) {
    assert.ok(String(dir).startsWith(NOTEBOOK_STORE_DIR), `${dir} 应位于 ${NOTEBOOK_STORE_DIR}`);
  }
  assert.equal(NOTEBOOK_DB_PATH, path.join(NOTEBOOK_STORE_DIR, 'notebook.db'));
});

test('safePathSegment 拒绝空值、点路径与路径分隔符穿越', () => {
  assert.equal(safePathSegment(' note-123 '), 'note-123');
  for (const bad of ['', '   ', null, undefined, '.', '..', 'a/b', 'a\\b', 'a\0b', '../etc/passwd']) {
    assert.throws(() => safePathSegment(bad), /无效/, `应拒绝 ${JSON.stringify(bad)}`);
  }
});

test('附件文件名只取 basename，绝不允许跳出资源目录', () => {
  const resourceDir = path.join(NOTEBOOK_CACHE_DIR, 'u1', 'n1', 'res');
  const target = path.join(resourceDir, 'audio.opus');
  assert.ok(target.startsWith(`${path.resolve(resourceDir)}${path.sep}`));
  assert.equal(path.basename('oss/a/b/audio.opus'), 'audio.opus');
});

test('getRelativeNotebookPath / resolveNotebookPath 双向约束在项目存储目录内', () => {
  const inside = path.join(NOTEBOOK_RECORDING_DIR, '1.ogg');
  const relative = getRelativeNotebookPath(inside);
  assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
  assert.equal(resolveNotebookPath(relative), inside);

  assert.throws(() => getRelativeNotebookPath('/etc/passwd'), /不属于项目存储目录/);
  assert.throws(() => getRelativeNotebookPath(NOTEBOOK_STORE_DIR), /不属于项目存储目录/);
  assert.throws(() => resolveNotebookPath('../../etc/passwd'), /缓存相对路径无效/);
  assert.throws(() => resolveNotebookPath(''), /缓存相对路径无效/);
  assert.throws(() => resolveNotebookPath('/etc/passwd'), /缓存相对路径无效/);
  assert.throws(() => resolveNotebookPath('../notebook-store-evil/x.db'), /缓存相对路径无效/);
});

test('mediaContentType 为录音格式给出可播放的 MIME，未知类型回退二进制', () => {
  assert.equal(mediaContentType('/a/b.ogg'), 'audio/ogg');
  assert.equal(mediaContentType('/a/b.OGG'), 'audio/ogg');
  assert.equal(mediaContentType('/a/b.opus'), 'audio/ogg; codecs=opus');
  assert.equal(mediaContentType('/a/b.wav'), 'audio/wav');
  assert.equal(mediaContentType('/a/b.mp3'), 'audio/mpeg');
  assert.equal(mediaContentType('/a/b.webm'), 'audio/webm; codecs=opus');
  assert.equal(mediaContentType('/a/b.bin'), 'application/octet-stream');
});

const startMediaServer = async (t, file) => {
  const server = http.createServer((req, res) => streamLocalMedia(req, res, file));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/audio`;
};

test('HTTP: 缺失缓存返回 404，而不是把空流当成可播放音频', { timeout: 15000 }, async (t) => {
  const base = await startMediaServer(t, path.join(os.tmpdir(), 'not-exist-audio.ogg'));
  const response = await fetch(base);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, '404');
  assert.match(body.desc, /音频缓存不存在/);
});

test('HTTP: 无 Range 返回 200 全量并声明 Accept-Ranges', { timeout: 15000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'a.opus');
  const payload = Buffer.from('OggS-not-really-opus-payload');
  fs.writeFileSync(file, payload);
  const base = await startMediaServer(t, file);

  const response = await fetch(base);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('accept-ranges'), 'bytes');
  assert.equal(response.headers.get('content-type'), 'audio/ogg; codecs=opus');
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  assert.equal(Number(response.headers.get('content-length')), payload.length);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload);
});

test('HTTP: 合法 Range 返回 206 且字节完全对齐', { timeout: 15000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'b.ogg');
  const payload = Buffer.from('OggS0123456789abcdef');
  fs.writeFileSync(file, payload);
  const base = await startMediaServer(t, file);

  const response = await fetch(base, { headers: { Range: 'bytes=4-9' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes 4-9/${payload.length}`);
  assert.equal(response.headers.get('content-length'), '6');
  assert.equal(Buffer.from(await response.arrayBuffer()).toString(), '012345');

  const tail = await fetch(base, { headers: { Range: 'bytes=10-' } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes 10-${payload.length - 1}/${payload.length}`);
  assert.deepEqual(Buffer.from(await tail.arrayBuffer()), payload.subarray(10));

  const clamped = await fetch(base, { headers: { Range: 'bytes=0-9999' } });
  assert.equal(clamped.status, 206);
  assert.equal(clamped.headers.get('content-range'), `bytes 0-${payload.length - 1}/${payload.length}`);
  assert.deepEqual(Buffer.from(await clamped.arrayBuffer()), payload);
});

test('HTTP: 后缀 Range 返回末尾 N 字节，超出文件长度时返回全文件', { timeout: 15000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'd.ogg');
  const payload = Buffer.from('OggS0123456789');
  fs.writeFileSync(file, payload);
  const base = await startMediaServer(t, file);

  const response = await fetch(base, { headers: { Range: 'bytes=-4' } });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get('content-range'), `bytes ${payload.length - 4}-${payload.length - 1}/${payload.length}`);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), payload.subarray(-4));
  for (const suffix of [String(payload.length), '999999999999999999999999999']) {
    const all = await fetch(base, {headers:{Range:`bytes=-${suffix}`}});
    assert.equal(all.status,206);
    assert.equal(all.headers.get('content-range'),`bytes 0-${payload.length-1}/${payload.length}`);
    assert.deepEqual(Buffer.from(await all.arrayBuffer()),payload);
  }

});

test('HTTP: 越界或畸形 Range 返回 416 且带 Content-Range: bytes */size', { timeout: 15000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'c.ogg');
  fs.writeFileSync(file, Buffer.from('OggS1234'));
  const base = await startMediaServer(t, file);

  for (const range of ['bytes=-', 'bytes=-0', 'bytes=999999999999999999999999-', 'bytes=99-', 'bytes=2-1', 'bytes=abc-def', 'items=0-1', 'bytes=0-1,3-4']) {
    const response = await fetch(base, { headers: { Range: range } });
    assert.equal(response.status, 416, `${range} 应返回 416`);
    assert.equal(response.headers.get('content-range'), 'bytes */8');
  }
});

test('HTTP: 空文件完整请求为200，所有字节范围均不可满足', async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'media-empty-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const file=path.join(dir,'empty.ogg');fs.writeFileSync(file,'');
  const base=await startMediaServer(t,file);
  const full=await fetch(base);assert.equal(full.status,200);assert.equal((await full.arrayBuffer()).byteLength,0);
  for(const range of ['bytes=0-','bytes=-1']) {
    const r=await fetch(base,{headers:{Range:range}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */0');
  }
});
