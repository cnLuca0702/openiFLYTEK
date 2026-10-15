// Sign in with ChatGPT —— OAuth 2.0 Authorization Code + PKCE 流程
// 参考 OpenAI Codex CLI 的公开客户端流程，使用户可用 ChatGPT Plus/Pro 订阅账号直接授权，
// 无需自行申请 API Key。
import http from 'node:http';
import crypto from 'node:crypto';
import { getChatGptTokens, setChatGptTokens, clearChatGptTokens } from './llm_config.js';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const AUTHORIZE_URL = 'https://auth.openai.com/oauth/authorize';
const TOKEN_URL = 'https://auth.openai.com/oauth/token';
const REDIRECT_URI = 'http://localhost:1455/auth/callback';
const SCOPE = 'openid profile email offline_access';
const CALLBACK_PORT = 1455;

let callbackServer = null;
let pendingLogin = null; // { verifier, state, startedAt, error, completed }

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function createPkce() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

function decodeJwtPayload(jwt) {
  try {
    const part = String(jwt || '').split('.')[1];
    if (!part) return {};
    return JSON.parse(Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
  } catch (_) {
    return {};
  }
}

function extractAccountInfo(idToken) {
  const payload = decodeJwtPayload(idToken);
  const auth = payload['https://api.openai.com/auth'] || {};
  return {
    accountId: auth.chatgpt_account_id || '',
    email: payload.email || '',
  };
}

function successPage(message) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>授权完成</title>
  <style>body{margin:0;height:100vh;display:flex;align-items:center;justify-content:center;
  background:#0A0E17;color:#e2e8f0;font-family:-apple-system,system-ui,sans-serif}
  .card{text-align:center;padding:40px 48px;border:1px solid #1e293b;border-radius:16px;background:#111827}
  h1{font-size:18px;margin:0 0 8px}p{font-size:13px;color:#94a3b8;margin:0}</style></head>
  <body><div class="card"><h1>${message}</h1><p>可以关闭此页面并返回 VIAIM Studio。</p></div></body></html>`;
}

async function exchangeCodeForTokens(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: pendingLogin.verifier,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || `令牌交换失败 (HTTP ${res.status})`);
  }
  const { accountId, email } = extractAccountInfo(json.id_token);
  setChatGptTokens({
    accessToken: json.access_token,
    refreshToken: json.refresh_token || '',
    accountId,
    email,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  });
  return { accountId, email };
}

function startCallbackServer() {
  if (callbackServer) return;
  callbackServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${CALLBACK_PORT}`);
    if (url.pathname !== '/auth/callback') {
      res.writeHead(404).end('Not Found');
      return;
    }
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');
    try {
      if (error) throw new Error(url.searchParams.get('error_description') || error);
      if (!pendingLogin || state !== pendingLogin.state) throw new Error('授权状态校验失败，请重试');
      if (!code) throw new Error('未收到授权码');
      const info = await exchangeCodeForTokens(code);
      pendingLogin.completed = { accountId: info.accountId, email: info.email };
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(successPage('✓ 已成功登录 ChatGPT'));
    } catch (err) {
      if (pendingLogin) pendingLogin.error = err.message;
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(successPage(`授权失败：${err.message}`));
    }
  });
  callbackServer.listen(CALLBACK_PORT, '127.0.0.1');
}

// 启动一次登录，返回浏览器授权地址
export function startChatGptLogin() {
  const { verifier, challenge } = createPkce();
  const state = base64Url(crypto.randomBytes(16));
  pendingLogin = { verifier, state, startedAt: Date.now(), error: null, completed: null };
  startCallbackServer();

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    originator: 'codex_cli_rs',
  });
  return { authUrl: `${AUTHORIZE_URL}?${params.toString()}` };
}

export function getChatGptLoginStatus() {
  const tokens = getChatGptTokens();
  return {
    loggedIn: !!tokens?.accessToken,
    email: tokens?.email || '',
    accountId: tokens?.accountId || '',
    pending: !!pendingLogin && !pendingLogin.completed && !pendingLogin.error,
    error: pendingLogin?.error || null,
  };
}

export function logoutChatGpt() {
  pendingLogin = null;
  clearChatGptTokens();
  return { success: true };
}

// 确保 access token 可用；near-expiry 时用 refresh_token 续期
export async function ensureFreshChatGptToken() {
  const tokens = getChatGptTokens();
  if (!tokens?.accessToken) throw new Error('尚未登录 ChatGPT，请在设置中完成授权');
  if (tokens.expiresAt && Date.now() < tokens.expiresAt - 120000) return tokens;
  if (!tokens.refreshToken) return tokens; // 无 refresh token，交由调用方处理 401

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: tokens.refreshToken,
      scope: SCOPE,
    }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.access_token) {
    clearChatGptTokens();
    throw new Error(json.error_description || 'ChatGPT 登录已过期，请重新登录');
  }
  const next = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || tokens.refreshToken,
    accountId: tokens.accountId,
    email: tokens.email,
    expiresAt: Date.now() + (Number(json.expires_in) || 3600) * 1000,
  };
  setChatGptTokens(next);
  return next;
}
