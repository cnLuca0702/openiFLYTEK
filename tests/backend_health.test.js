import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import health from '../electron/backend-health.cjs';

test('桌面启动拒绝旧 HTML 后端、错误版本和缺失能力，等待正确后端就绪', async t => {
  let response = '<!DOCTYPE html><pre>Cannot GET /api/health</pre>', status = 404;
  const server = http.createServer((_req, res) => {res.writeHead(status);res.end(response);});
  server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(() => server.close());
  const port = server.address().port;
  assert.equal(await health.checkBackend(port, '1.2.0'), false);
  status = 200;
  response = JSON.stringify({app:'OpeniFLYTEK', version:'1.1.0', capabilities:['memory-panorama']});
  assert.equal(await health.checkBackend(port, '1.2.0'), false);
  response = JSON.stringify({app:'OpeniFLYTEK', version:'1.2.0', capabilities:[]});
  assert.equal(await health.checkBackend(port, '1.2.0'), false);
  const timer = setTimeout(() => {response = JSON.stringify({app:'OpeniFLYTEK', version:'1.2.0', capabilities:['memory-panorama']});}, 200);
  t.after(() => clearTimeout(timer));
  await health.waitForBackend(port, '1.2.0', {exitCode:null}, 2000);
  await assert.rejects(health.waitForBackend(port, '1.2.0', {exitCode:1}), /启动失败/);
  await assert.rejects(health.waitForBackend(port, 'wrong-version', {exitCode:null}, 200), /未能及时就绪/);
});
