const http = require('node:http');

function checkBackend(port, version) {
  return new Promise((resolve) => {
    const req = http.get({hostname: '127.0.0.1', port, path: '/api/health', timeout: 1500}, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; if (body.length > 16384) req.destroy(); });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(res.statusCode === 200 && data.app === 'OpeniFLYTEK' && data.version === version && data.capabilities?.includes('memory-panorama'));
        } catch { resolve(false); }
      });
      res.on('error', () => resolve(false));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function waitForBackend(port, version, child, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode || child.spawnError) throw new Error('内置服务启动失败，请检查应用日志。');
    if (await checkBackend(port, version)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error('内置服务未能及时就绪，请退出后重试。');
}
module.exports = {checkBackend, waitForBackend};
