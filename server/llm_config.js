// 大模型配置的本地持久化（含密钥，仅存于用户本机应用数据目录）
import fs from 'node:fs';
import path from 'node:path';
import { APP_DATA_DIR } from './storage_paths.js';

export const LLM_CONFIG_PATH = path.join(APP_DATA_DIR, 'config', 'llm.json');

const EMPTY = {
  provider: '',
  autoSummary: true,
  providers: {},        // { [providerId]: { apiKey, baseUrl, model } }
  chatgpt: null,        // { accessToken, refreshToken, accountId, expiresAt, email }
  asr: { mode: 'local', priority: 'local' }, // mode: local | online | stream；priority: local | online
};

export const DEFAULT_ASR = { mode: 'local', priority: 'local' };

export function normalizeAsrConfig(value) {
  const v = value && typeof value === 'object' ? value : {};
  const mode = ['local', 'online', 'stream'].includes(v.mode) ? v.mode : DEFAULT_ASR.mode;
  const priority = ['local', 'online'].includes(v.priority) ? v.priority : DEFAULT_ASR.priority;
  return { mode, priority };
}

function ensureDir() {
  fs.mkdirSync(path.dirname(LLM_CONFIG_PATH), { recursive: true });
}

export function loadConfig() {
  try {
    if (!fs.existsSync(LLM_CONFIG_PATH)) return { ...EMPTY, providers: {} };
    const raw = JSON.parse(fs.readFileSync(LLM_CONFIG_PATH, 'utf-8'));
    return {
      ...EMPTY,
      ...raw,
      providers: raw.providers && typeof raw.providers === 'object' ? raw.providers : {},
      asr: normalizeAsrConfig(raw.asr),
    };
  } catch (err) {
    console.warn('[llm_config] 读取配置失败，使用默认值:', err.message);
    return { ...EMPTY, providers: {} };
  }
}

export function saveConfig(patch) {
  const current = loadConfig();
  const next = {
    ...current,
    ...patch,
    providers: { ...current.providers, ...(patch.providers || {}) },
  };
  ensureDir();
  fs.writeFileSync(LLM_CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  return next;
}

export function updateProviderConfig(providerId, { apiKey, baseUrl, model }) {
  const current = loadConfig();
  const prev = current.providers[providerId] || {};
  // apiKey 不传（undefined）视为“保持原值”；传 null 或空串视为“清空”
  const nextApiKey = apiKey === undefined ? prev.apiKey : apiKey;
  return saveConfig({
    providers: {
      [providerId]: {
        apiKey: nextApiKey === null ? '' : String(nextApiKey || ''),
        baseUrl: baseUrl === undefined ? prev.baseUrl : String(baseUrl || ''),
        model: model === undefined ? prev.model : String(model || ''),
      },
    },
  });
}

export function getChatGptTokens() {
  return loadConfig().chatgpt || null;
}

export function setChatGptTokens(tokens) {
  return saveConfig({ chatgpt: tokens });
}

export function clearChatGptTokens() {
  return saveConfig({ chatgpt: null });
}

function maskSecret(value) {
  const s = String(value || '');
  if (!s) return '';
  if (s.length <= 8) return '••••••';
  return `${s.slice(0, 4)}••••${s.slice(-4)}`;
}

// 返回给前端的安全视图：密钥一律脱敏
export function getPublicConfig() {
  const cfg = loadConfig();
  const providers = {};
  for (const [id, value] of Object.entries(cfg.providers)) {
    providers[id] = {
      apiKeySet: !!value.apiKey,
      apiKeyMasked: maskSecret(value.apiKey),
      baseUrl: value.baseUrl || '',
      model: value.model || '',
    };
  }
  return {
    provider: cfg.provider || '',
    autoSummary: cfg.autoSummary !== false,
    providers,
    embedding: {enabled: cfg.embedding?.enabled === true, baseUrl: cfg.embedding?.baseUrl || '', model: cfg.embedding?.model || '', apiKeySet: !!cfg.embedding?.apiKey},
    asr: normalizeAsrConfig(cfg.asr),
    chatgpt: cfg.chatgpt
      ? { loggedIn: true, email: cfg.chatgpt.email || '', accountId: cfg.chatgpt.accountId || '' }
      : { loggedIn: false, email: '', accountId: '' },
  };
}

// 取 ASR 配置（服务端使用）
export function getAsrConfig() {
  return normalizeAsrConfig(loadConfig().asr);
}

// 取某个服务商的有效运行时配置（含明文密钥，仅服务端使用）
export function resolveProviderRuntime(providerId) {
  const cfg = loadConfig();
  const id = providerId || cfg.provider;
  const stored = cfg.providers[id] || {};
  return { id, ...stored, chatgpt: id === 'chatgpt' ? cfg.chatgpt : null };
}

export function updateEmbeddingConfig(patch) {
  const previous = loadConfig().embedding || {};
  const next = {...previous};
  if (patch.enabled !== undefined) next.enabled = patch.enabled === true;
  for (const key of ['baseUrl','model','apiKey']) if (patch[key] !== undefined) next[key] = String(patch[key] || '').trim();
  if (next.baseUrl) {
    const url = new URL(next.baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('向量服务地址须为 HTTP(S)，不能包含凭据或查询参数');
  }
  if (next.enabled && (!next.baseUrl || !next.model)) throw new Error('请填写向量服务地址和模型名称');
  return saveConfig({embedding:next});
}
