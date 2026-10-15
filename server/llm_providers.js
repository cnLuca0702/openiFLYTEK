// 大模型服务商注册表
// kind:
//   'openai-compatible' -> 走标准 /chat/completions 协议
//   'chatgpt-oauth'     -> 走 Sign in with ChatGPT (OAuth PKCE) + Responses API
export const PROVIDERS = [
  {
    id: 'chatgpt',
    label: 'Sign in with ChatGPT',
    kind: 'chatgpt-oauth',
    requiresApiKey: false,
    defaultBaseUrl: 'https://chatgpt.com/backend-api/codex',
    defaultModel: '',
    description: '使用 ChatGPT Plus / Pro 账号登录授权，无需 API Key。'
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    kind: 'openai-compatible',
    requiresApiKey: true,
    defaultBaseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    defaultModel: 'glm-4-plus',
    description: '智谱开放平台，控制台申请 API Key（形如 xxxx.yyyy）。'
  },
  {
    id: 'minimax',
    label: 'MiniMax',
    kind: 'openai-compatible',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.minimax.chat/v1',
    defaultModel: 'MiniMax-Text-01',
    description: 'MiniMax 开放平台 API Key 与 GroupId。'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai-compatible',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    description: 'DeepSeek 开放平台，API Key 形如 sk-xxxx。'
  },
  {
    id: 'openai',
    label: 'OpenAI API',
    kind: 'openai-compatible',
    requiresApiKey: true,
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    description: 'OpenAI 官方 API（按量计费，与 ChatGPT 订阅账号无关）。'
  },
  {
    id: 'custom',
    label: '自定义 OpenAI 兼容',
    kind: 'openai-compatible',
    requiresApiKey: true,
    defaultBaseUrl: '',
    defaultModel: '',
    custom: true,
    description: '任何兼容 /chat/completions 的服务（vLLM、Ollama、One-API 网关等）。'
  }
];

export function getProvider(id) {
  return PROVIDERS.find((p) => p.id === id) || null;
}

// 对外暴露（不含任何密钥）
export function publicProviders() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    kind: p.kind,
    requiresApiKey: p.requiresApiKey,
    defaultBaseUrl: p.defaultBaseUrl,
    defaultModel: p.defaultModel,
    custom: !!p.custom,
    description: p.description
  }));
}
