// 统一的大模型调用客户端
// 支持两类协议：
//   1) OpenAI 兼容 /chat/completions（glm / minimax / deepseek / openai / custom）
//   2) Sign in with ChatGPT → Responses API（chatgpt-oauth）
import { getProvider } from './llm_providers.js';
import { resolveProviderRuntime } from './llm_config.js';
import { ensureFreshChatGptToken } from './chatgpt_oauth.js';

// 将表单中的临时值（尚未保存）叠加到已存运行时配置之上
function applyOverride(runtime, override) {
  if (!override || typeof override !== 'object') return runtime;
  const next = { ...runtime };
  if (typeof override.apiKey === 'string' && override.apiKey.trim()) next.apiKey = override.apiKey.trim();
  if (typeof override.baseUrl === 'string' && override.baseUrl.trim()) next.baseUrl = override.baseUrl.trim();
  if (typeof override.model === 'string' && override.model.trim()) next.model = override.model.trim();
  return next;
}

function extractModelIds(data) {
  const list = data?.data || data?.models;
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => (typeof m === 'string' ? m : m?.id || m?.model || m?.name || m?.slug))
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim());
}

function httpErrorMessage(status, bodyText, provider) {
  const label = provider?.label || '模型服务';
  if (status === 401 || status === 403) return `${label} 鉴权失败（HTTP ${status}），请检查 API Key 是否正确/有效。`;
  if (status === 404) return `${label} 接口不存在（HTTP 404），请检查 Base URL 是否填写正确。`;
  if (status === 429) return `${label} 触发限流（HTTP 429），请稍后重试。`;
  const brief = String(bodyText || '').slice(0, 300);
  return `${label} 请求失败（HTTP ${status}）: ${brief}`;
}

async function openAiCompatibleChat({ runtime, provider, system, user, temperature, maxTokens, json }) {
  const baseUrl = String(runtime.baseUrl || provider.defaultBaseUrl || '').replace(/\/+$/, '');
  const model = runtime.model || provider.defaultModel;
  const apiKey = runtime.apiKey;

  if (!baseUrl) throw new Error(`请先为「${provider.label}」配置 Base URL`);
  if (!model) throw new Error(`请先为「${provider.label}」配置模型名称`);
  if (provider.requiresApiKey && !apiKey) throw new Error(`请先为「${provider.label}」配置 API Key`);

  const messages = [];
  if (system) messages.push({ role: 'system', content: system });
  messages.push({ role: 'user', content: user });

  const buildBody = (withJsonMode) => ({
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(json && withJsonMode ? { response_format: { type: 'json_object' } } : {}),
    // 智谱 GLM 思考型模型：关闭思考，保证结构化输出稳定且不被思考 token 吃掉预算
    ...(baseUrl.includes('bigmodel.cn') ? { thinking: { type: 'disabled' } } : {}),
  });

  const send = async (withJsonMode) => {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(buildBody(withJsonMode)),
    });
    const text = await res.text();
    return { res, text };
  };

  let { res, text } = await send(true);
  // 部分服务商不支持 response_format，自动降级重试一次
  if (!res.ok && res.status === 400 && json && /response_format|json_object|not support/i.test(text)) {
    ({ res, text } = await send(false));
  }
  if (!res.ok) throw new Error(httpErrorMessage(res.status, text, provider));

  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error(`${provider.label} 返回了非 JSON 响应`); }
  const message = data?.choices?.[0]?.message || {};
  let content = message.content;
  content = typeof content === 'string' ? content : (content ? JSON.stringify(content) : '');
  // GLM / DeepSeek 等思考型模型在 max_tokens 偏小时可能只产出 reasoning_content、content 为空
  if (!content.trim() && typeof message.reasoning_content === 'string' && message.reasoning_content.trim()) {
    content = message.reasoning_content.trim();
  }
  if (!content) throw new Error(`${provider.label} 未返回有效内容`);
  return { content, model, raw: data };
}

async function chatGptResponses({ runtime, provider, system, user, maxTokens, json }) {
  const tokens = await ensureFreshChatGptToken();
  const baseUrl = String(runtime.baseUrl || provider.defaultBaseUrl || 'https://chatgpt.com/backend-api/codex').replace(/\/+$/, '');
  const model = runtime.model || provider.defaultModel;
  if (!model) throw new Error(`请先在「设置 → 大模型引擎」为「${provider.label}」拉取并选择要使用的模型`);

  const res = await fetch(`${baseUrl}/responses`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${tokens.accessToken}`,
      'OpenAI-Beta': 'responses=experimental',
      originator: 'codex_cli_rs',
      Accept: 'text/event-stream',
      ...(tokens.accountId ? { 'chatgpt-account-id': tokens.accountId } : {}),
    },
    body: JSON.stringify({
      model,
      instructions: system || undefined,
      input: [
        {
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: json ? `${user}\n\n只输出 JSON，不要包含任何解释或 Markdown 代码块。` : user }],
        },
      ],
      store: false,
      stream: true,
      ...(json ? { text: { format: { type: 'json_object' } } } : {}),
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(httpErrorMessage(res.status, errText, provider));
  }

  // 解析 SSE 流，拼接增量文本
  let output = '';
  let buffer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(payload); } catch (_) { continue; }
      const type = evt.type || '';
      if (type === 'response.output_text.delta' && typeof evt.delta === 'string') {
        output += evt.delta;
      } else if (type === 'response.output_item.done' && evt.item?.content) {
        for (const c of evt.item.content) {
          if (c.type === 'output_text' && typeof c.text === 'string' && !output) output += c.text;
        }
      } else if (type === 'response.completed' && evt.response?.output) {
        if (!output) {
          for (const item of evt.response.output) {
            for (const c of item.content || []) {
              if (c.type === 'output_text' && typeof c.text === 'string') output += c.text;
            }
          }
        }
      } else if (type === 'response.failed' || type === 'error') {
        throw new Error(evt.response?.error?.message || evt.message || 'ChatGPT 返回了错误事件');
      }
    }
  }

  if (!output.trim()) throw new Error('ChatGPT 未返回有效内容（请确认账号已开通 Plus/Pro 且模型可用）');
  return { content: output, model };
}

// 统一入口
export async function chat({ system, user, temperature = 0.3, maxTokens = 2048, json = false, providerId, override } = {}) {
  const runtime = applyOverride(resolveProviderRuntime(providerId), override);
  const provider = getProvider(runtime.id);
  if (!provider) throw new Error('未配置大模型服务商，请前往「设置 → 大模型引擎」选择并配置');
  if (provider.kind === 'chatgpt-oauth') {
    return chatGptResponses({ runtime, provider, system, user, maxTokens, json });
  }
  return openAiCompatibleChat({ runtime, provider, system, user, temperature, maxTokens, json });
}

// 连通性测试（可传入 override 以测试尚未保存的表单值）
export async function testProvider(providerId, override) {
  const result = await chat({
    providerId,
    override,
    system: '你是一个连通性测试助手。',
    user: '请只回复两个字：正常',
    maxTokens: 512,
    temperature: 0,
  });
  return { ok: true, model: result.model, reply: String(result.content).trim().slice(0, 80) };
}

// 自动拉取服务商可用模型列表
const CHATGPT_FALLBACK_MODELS = ['gpt-5', 'gpt-5-codex', 'gpt-4.1', 'gpt-4o'];

export async function listModels(providerId, override) {
  const runtime = applyOverride(resolveProviderRuntime(providerId), override);
  const provider = getProvider(runtime.id);
  if (!provider) throw new Error('未配置大模型服务商，请前往「设置 → 大模型引擎」选择并配置');

  const baseUrl = String(runtime.baseUrl || provider.defaultBaseUrl || '').replace(/\/+$/, '');

  if (provider.kind === 'chatgpt-oauth') {
    // Codex 后端不保证开放 /models，失败时回退内置清单
    try {
      const tokens = await ensureFreshChatGptToken();
      const res = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${tokens.accessToken}`,
          originator: 'codex_cli_rs',
          ...(tokens.accountId ? { 'chatgpt-account-id': tokens.accountId } : {}),
        },
      });
      if (res.ok) {
        const ids = extractModelIds(await res.json());
        if (ids.length) return { models: ids, source: 'remote' };
      }
    } catch (_) {
      /* 回退内置清单 */
    }
    return { models: CHATGPT_FALLBACK_MODELS, source: 'builtin' };
  }

  const apiKey = runtime.apiKey;
  if (!baseUrl) throw new Error(`请先为「${provider.label}」配置 Base URL`);
  if (provider.requiresApiKey && !apiKey) throw new Error(`请先为「${provider.label}」配置 API Key`);

  const res = await fetch(`${baseUrl}/models`, {
    headers: { ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(httpErrorMessage(res.status, text, provider));
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error(`${provider.label} 返回了非 JSON 响应`); }
  const ids = extractModelIds(data).sort();
  if (!ids.length) throw new Error(`${provider.label} 未返回可用模型列表`);
  return { models: ids, source: 'remote' };
}
