import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'llm-config-'));
process.env.HOME = home;
process.env.USERPROFILE = home;

const {
  LLM_CONFIG_PATH,
  DEFAULT_ASR,
  normalizeAsrConfig,
  loadConfig,
  saveConfig,
  updateProviderConfig,
  setChatGptTokens,
  clearChatGptTokens,
  getChatGptTokens,
  getPublicConfig,
  getAsrConfig,
  resolveProviderRuntime,
} = await import('../server/llm_config.js');
const { PROVIDERS, getProvider, publicProviders } = await import('../server/llm_providers.js');

test('配置与令牌文件只落在应用数据目录，权限 0600', () => {
  assert.ok(LLM_CONFIG_PATH.startsWith(path.join(home, 'Library', 'Application Support', 'VIAIM Studio')));
  saveConfig({ provider: 'glm', providers: { glm: { apiKey: 'secret-key-value-1234', baseUrl: 'https://example.test', model: 'glm-4' } } });
  const stat = fs.statSync(LLM_CONFIG_PATH);
  assert.equal(stat.mode & 0o777, 0o600, '含密钥的配置文件不得对其他用户可读');
});

test('ASR 配置只接受白名单值，非法值回落到默认', () => {
  assert.deepEqual(normalizeAsrConfig({ mode: 'online', priority: 'online' }), { mode: 'online', priority: 'online' });
  assert.deepEqual(normalizeAsrConfig({ mode: 'stream', priority: 'nope' }), { mode: 'stream', priority: DEFAULT_ASR.priority });
  assert.deepEqual(normalizeAsrConfig({ mode: 'unknown' }), DEFAULT_ASR);
  assert.deepEqual(normalizeAsrConfig(null), DEFAULT_ASR);
  assert.deepEqual(normalizeAsrConfig('local'), DEFAULT_ASR);
});

test('配置文件缺失或损坏时回落到默认值而不是抛错', () => {
  fs.rmSync(LLM_CONFIG_PATH, { force: true });
  const fresh = loadConfig();
  assert.equal(fresh.provider, '');
  assert.equal(fresh.autoSummary, true);
  assert.deepEqual(fresh.providers, {});

  fs.writeFileSync(LLM_CONFIG_PATH, '{ broken json');
  const recovered = loadConfig();
  assert.deepEqual(recovered.providers, {});
  assert.equal(recovered.provider, '');
});

test('服务商配置按合并语义更新，apiKey 不传保持、传空清空', () => {
  updateProviderConfig('custom', { apiKey: 'abcdefghijklmnop', baseUrl: 'https://a.test', model: 'm1' });
  updateProviderConfig('custom', { model: 'm2' });
  let stored = loadConfig().providers.custom;
  assert.equal(stored.apiKey, 'abcdefghijklmnop', '未传 apiKey 应保留原值');
  assert.equal(stored.model, 'm2');
  assert.equal(stored.baseUrl, 'https://a.test');

  updateProviderConfig('custom', { apiKey: '' });
  stored = loadConfig().providers.custom;
  assert.equal(stored.apiKey, '');
  assert.equal(stored.baseUrl, 'https://a.test', '清空密钥不应影响其他字段');

  saveConfig({ providers: { glm: { apiKey: 'glm-key', baseUrl: 'https://glm.test', model: 'glm-4' } } });
  assert.deepEqual(Object.keys(loadConfig().providers).sort(), ['custom', 'glm'], '保存新服务商不得覆盖已有服务商');
});

test('对外视图只暴露脱敏密钥，绝不返回明文', () => {
  updateProviderConfig('custom', { apiKey: 'abcdefghijklmnop', baseUrl: 'https://a.test', model: 'm2' });
  updateProviderConfig('glm', { apiKey: 'short', baseUrl: 'https://glm.test', model: 'glm-4' });
  const pub = getPublicConfig();
  const serialized = JSON.stringify(pub);
  assert.ok(!serialized.includes('abcdefghijklmnop'), '长密钥不得出现在对外视图');
  assert.ok(!serialized.includes('short'), '短密钥不得出现在对外视图');
  assert.equal(pub.providers.custom.apiKeySet, true);
  assert.equal(pub.providers.custom.apiKeyMasked, 'abcd••••mnop');
  assert.equal(pub.providers.glm.apiKeyMasked, '••••••');
  assert.equal(pub.providers.glm.apiKeySet, true);
  assert.equal(pub.providers.custom.baseUrl, 'https://a.test');

  const runtime = resolveProviderRuntime('custom');
  assert.equal(runtime.apiKey, 'abcdefghijklmnop', '仅服务端运行时可取明文');
  assert.equal(resolveProviderRuntime().id, loadConfig().provider === '' ? '' : loadConfig().provider);
});

test('ChatGPT 登录态：登出后对外视图不再声称已登录', () => {
  setChatGptTokens({ accessToken: 'at', refreshToken: 'rt', accountId: 'acc-1', email: 'user@test', expiresAt: Date.now() + 3600_000 });
  assert.equal(getChatGptTokens().accountId, 'acc-1');
  const pub = getPublicConfig();
  assert.equal(pub.chatgpt.loggedIn, true);
  assert.equal(pub.chatgpt.email, 'user@test');
  assert.equal(pub.chatgpt.accountId, 'acc-1');
  assert.ok(!('accessToken' in pub.chatgpt), '不得下发 accessToken');
  assert.ok(!JSON.stringify(pub).includes('"at"'), '不得下发令牌内容');

  clearChatGptTokens();
  assert.equal(getChatGptTokens(), null);
  assert.equal(getPublicConfig().chatgpt.loggedIn, false);
  assert.equal(resolveProviderRuntime('chatgpt').chatgpt, null);
});

test('自动摘要开关与 ASR 配置持久化', () => {
  saveConfig({ autoSummary: false, asr: { mode: 'stream', priority: 'online' } });
  assert.equal(getPublicConfig().autoSummary, false);
  assert.deepEqual(getAsrConfig(), { mode: 'stream', priority: 'online' });
  saveConfig({ asr: { mode: 'bad' } });
  assert.deepEqual(getAsrConfig(), DEFAULT_ASR);
});

test('服务商注册表可公开导出且不含任何密钥字段', () => {
  const ids = PROVIDERS.map((p) => p.id);
  for (const id of ['chatgpt', 'glm', 'minimax', 'deepseek', 'openai', 'custom']) {
    assert.ok(ids.includes(id), `注册表缺少 ${id}`);
  }
  assert.equal(getProvider('chatgpt').kind, 'chatgpt-oauth');
  assert.equal(getProvider('chatgpt').requiresApiKey, false);
  assert.equal(getProvider('glm').defaultBaseUrl, 'https://open.bigmodel.cn/api/coding/paas/v4');
  assert.equal(getProvider('custom').requiresApiKey, true);
  assert.equal(getProvider('unknown-id'), null);
  assert.deepEqual(publicProviders(), PROVIDERS.map((p) => ({ ...p, custom: !!p.custom })));
  const serialized = JSON.stringify(publicProviders());
  assert.ok(!serialized.includes('apiKey'), '注册表不应包含密钥字段');
});
test('向量配置独立保存、密钥不下发且留空字段保持原值',async()=>{
  const {updateEmbeddingConfig}=await import('../server/llm_config.js');
  updateEmbeddingConfig({enabled:true,baseUrl:'http://localhost:11434/v1',model:'embedding-model',apiKey:'embedding-secret'});
  assert.equal(getPublicConfig().embedding.apiKeySet,true);
  assert.ok(!JSON.stringify(getPublicConfig()).includes('embedding-secret'));
  updateEmbeddingConfig({model:'new-model'});assert.equal(loadConfig().embedding.apiKey,'embedding-secret');
  assert.throws(()=>updateEmbeddingConfig({baseUrl:'https://user:password@example.com/v1'}));
  assert.equal(loadConfig().embedding.model,'new-model');
  updateEmbeddingConfig({apiKey:''});assert.equal(getPublicConfig().embedding.apiKeySet,false);
});
