import { Meeting, Sentence, AiSummary, TodoItem, OfficeNotebookDevice, OfficeNotebookNote, DevicesStatusResponse, UserProfile, LlmProviderMeta, LlmPublicConfig, ChatGptLoginStatus, LlmModelList, AsrStatus } from '../types';

const BASE_URL = 'http://localhost:3800/api';

export interface MemoryCitation {
  sourceType?: "meeting" | "document";
  pages?: number[];
  location?: string;
  ref: number;
  chunkId: number;
  meetingId: string;
  version: string;
  title: string;
  occurredAt: string;
  startMs: number;
  endMs: number;
  excerpt: string;
  sentenceIds: string[];
}

export interface MemoryProject {
  id: string;
  name: string;
  scope: string;
  code: string;
  aliases: string[];
  linked: boolean;
  ambiguous: boolean;
  states: Array<{
    aspect: string;
    property: string;
    status: 'current' | 'conflict' | 'uncertain';
    currentFactIds: string[];
    links: Array<{ from: string; to: string; evidenceFactId: string; effectiveAt: string }>;
    history: Array<{
      id: string;
      chunkId: number;
      value: string;
      normalizedValue: string;
      status: 'current' | 'superseded' | 'proposed' | 'scheduled' | 'uncertain';
      supersededBy: string | null;
      observedAt: string;
      effectiveAt: string | null;
      recordedAt: string;
      quote: string;
      dateUncertain: boolean;
      ref: number;
    }>;
  }>;
}

// 办公本推送结果（每个目标独立成功/失败）
export interface NotebookPushTargetResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  error?: string;
  code?: string;
  stage?: string | null;
  tokenExpired?: boolean;
  needRecordAuth?: boolean;
  fileName?: string;
  noteId?: string;
  updated?: boolean;
  durationMs?: number;
  textEntries?: number;
  dirName?: string;
}
export interface NotebookPushResponse {
  status: 'success' | 'partial';
  message: string;
  results: { fileport?: NotebookPushTargetResult; record?: NotebookPushTargetResult };
  fileName?: string;
  filePortId?: string;
  localFile?: string;
}

// 全局 token 失效事件总线（订阅后当任意请求检测到 detail.tokenExpired=true 时触发）
type TokenExpiredHandler = () => void;
const tokenExpiredHandlers: Set<TokenExpiredHandler> = new Set();
export const onTokenExpired = (h: TokenExpiredHandler) => {
  tokenExpiredHandlers.add(h);
  return () => tokenExpiredHandlers.delete(h);
};
const fireTokenExpired = () => {
  tokenExpiredHandlers.forEach((h) => {
    try { h(); } catch (_) {}
  });
};

// 通用 fetch 包装：检测 detail.tokenExpired 自动派发事件
async function apiFetch(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, init);
  let json: any = null;
  try {
    json = await res.json();
  } catch (_) {
    // non-json
  }
  if (json && json.detail && json.detail.tokenExpired === true) {
    fireTokenExpired();
  }
  return json;
}

export interface DocumentInfo {id:string;name:string;ext:string;digest:string;uploadedAt:string;status:string;error:string;pageCount:number;interpreted:number;materialDate:string;replaces:string}
export interface DocumentDetail extends DocumentInfo {pages:Array<{number:number;label:string;text:string;image:boolean;ledger?:{facts:string;charts:string}}> ;knowledge:Array<{overview:string;units:Array<{question:string;answer:string;basis:string;pages:number[]}>}>}
export interface MemoryPanorama {
  sources:Array<{id:string;title:string;type:string;date:string;chunks:number;facts:number;knowledgeUnits:number;citation:MemoryCitation}>;
  topics:Array<{id:string;type:string;scope:string;name:string;sourceIds:string[];facts:number}>;
  topicCount:number;unavailable:number;limited:boolean;pending:number;
  totals:{sources:number;documents:number;meetings:number;facts:number;knowledgeUnits:number};
}
export interface MemoryInsights {pending:number;citations:MemoryCitation[];followups:Array<{id:string;type:string;scope:string;project:string;item:string;status:string;owners:string[];dueDate:string|null;overdue:boolean;history:Array<{id:string;chunkId:number;quote:string;observedAt:string}>}>;changes:Array<{scope:string;project:string;aspect:string;status:string;history:Array<{id:string;chunkId:number;quote:string}>}>}
async function memoryRequest<T>(url:string,options?:RequestInit):Promise<T> {const res=await fetch(`${BASE_URL}${url}`,options);const data=await res.json();if(!res.ok||data.code!=='000000')throw new Error(data.desc||'记忆请求失败');return data.data;}
export const api = {
  memoryPanorama: () => memoryRequest<MemoryPanorama>('/memory/panorama'),
  documents: () => memoryRequest<DocumentInfo[]>('/documents'),
  document: (id:string) => memoryRequest<DocumentDetail>(`/documents/${encodeURIComponent(id)}`),
  uploadDocument: (file:File,replaces?:string) => { if(file.size>40*1024*1024||!file.size)return Promise.reject(new Error('文件不能为空，单文件最大40MB')); return memoryRequest<DocumentInfo>(`/documents?name=${encodeURIComponent(file.name)}&replaces=${encodeURIComponent(replaces||'')}`,{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file}); },
  deleteDocument: (id:string) => memoryRequest<boolean>(`/documents/${encodeURIComponent(id)}`,{method:'DELETE'}),
  retryDocument: (id:string) => memoryRequest<boolean>(`/documents/${encodeURIComponent(id)}/retry`,{method:'POST'}),
  documentFile: (id:string,kind:string,page?:number) => `${BASE_URL}/documents/${encodeURIComponent(id)}/file/${kind}${page?`?page=${page}`:''}`,
  memoryStatus: () => memoryRequest<{semantic?:{state:string;indexed:number;pending:number}}>('/memory/status'),
  memoryInsights: (meetingId?:string) => memoryRequest<MemoryInsights>(`/memory/insights${meetingId?`?meetingId=${encodeURIComponent(meetingId)}`:''}`),
  // 获取用户真实个人资料（从 setting.ini 读取）
  async getUserProfile(): Promise<UserProfile> {
    const res = await fetch(`${BASE_URL}/user/profile`);
    const json = await res.json();
    return json.data;
  },

  // 获取真实会议列表（从 SQLite kitdb.db）
  async getMeetings(): Promise<Meeting[]> {
    const res = await fetch(`${BASE_URL}/meetings`);
    const json = await res.json();
    return json.data;
  },

  // 获取单个会议的完整真实详情（包含所有句子、音频URL、完整纪要）
  async getMeetingDetail(id: string): Promise<Meeting> {
    const res = await fetch(`${BASE_URL}/meetings/${encodeURIComponent(id)}`);
    const json = await res.json();
    return json.data;
  },

  // 录音结束并保存到数据库
  async saveRecordedMeeting(payload: {
    title: string;
    durationMs: number;
    sentences: Partial<Sentence>[];
    audioBase64?: string;
  }): Promise<Meeting> {
    const res = await fetch(`${BASE_URL}/meetings/record`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    return json.data;
  },

  // 切换真实待办状态
  async toggleTodo(meetingId: string, todoId: string): Promise<TodoItem[]> {
    const res = await fetch(`${BASE_URL}/meetings/${meetingId}/todos/${todoId}/toggle`, {
      method: 'POST',
    });
    const json = await res.json();
    return json.data;
  },

  // 录音离线转写（ffmpeg + 智谱 glm-asr，转写结果含标记点合并）
  async transcribeMeeting(meetingId: string): Promise<Meeting> {
    const json = await apiFetch(`${BASE_URL}/meetings/${encodeURIComponent(meetingId)}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    if (json?.code !== '000000') throw new Error(json?.desc || '音频转写失败');
    return json.data;
  },

  // AI 纪要生成（force=true 时忽略缓存，强制重新调用大模型提炼）
  async generateAiSummary(meetingId: string, options: { force?: boolean } = {}): Promise<AiSummary> {
    const json = await apiFetch(`${BASE_URL}/meetings/${encodeURIComponent(meetingId)}/generate-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force: options.force === true }),
    });
    if (json?.code !== '000000') {
      const error = new Error(json?.desc || 'AI 纪要提炼失败') as Error & { code?: string; detail?: any };
      error.code = json?.code;
      error.detail = json?.detail;
      throw error;
    }
    return json.data;
  },

  // AI 问答：@ 一条或多条录音作为上下文，可指定已配置的模型回答
  async aiChat(payload: { question: string; meetingIds: string[]; currentMeetingId?: string; providerId?: string; model?: string }): Promise<{ answer: string; model: string; citations?: MemoryCitation[]; projects?: MemoryProject[]; memoryWarnings?: string[] }> {
    const json = await apiFetch(`${BASE_URL}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (json?.code !== '000000') {
      const error = new Error(json?.desc || 'AI 问答失败') as Error & { code?: string };
      error.code = json?.code;
      throw error;
    }
    return json.data;
  },

  async relatedMemories(meetingId: string): Promise<MemoryCitation[]> {
    const json = await apiFetch(`${BASE_URL}/memory/related/${encodeURIComponent(meetingId)}`);
    return json?.code === '000000' ? json.data : [];
  },

  async memoryEvidence(citation: MemoryCitation): Promise<MemoryCitation> {
    const json = await apiFetch(`${BASE_URL}/memory/evidence/${citation.chunkId}?version=${encodeURIComponent(citation.version)}`);
    if (json?.code !== '000000') throw new Error(json?.desc || '来源暂不可读取');
    return json.data;
  },

  // ================= 大模型引擎配置（用户自配置） =================

  // 可选服务商清单
  async getLlmProviders(): Promise<LlmProviderMeta[]> {
    const json = await apiFetch(`${BASE_URL}/llm/providers`);
    if (json?.code !== '000000') throw new Error(json?.desc || '读取服务商清单失败');
    return json.data;
  },

  // 当前配置（密钥已脱敏）
  async getLlmConfig(): Promise<LlmPublicConfig> {
    const json = await apiFetch(`${BASE_URL}/llm/config`);
    if (json?.code !== '000000') throw new Error(json?.desc || '读取大模型配置失败');
    return json.data;
  },

  // 保存配置：provider=默认服务商 / autoSummary=自动提炼 / providerConfig=某服务商字段 / asr=语音转写设置
  async saveLlmConfig(payload: {
    embedding?: {enabled?:boolean; baseUrl?:string; model?:string; apiKey?:string};
    provider?: string;
    autoSummary?: boolean;
    providerId?: string;
    providerConfig?: { apiKey?: string; baseUrl?: string; model?: string };
    asr?: { mode: 'local' | 'online' | 'stream'; priority: 'local' | 'online' };
  }): Promise<LlmPublicConfig> {
    const json = await apiFetch(`${BASE_URL}/llm/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (json?.code !== '000000') throw new Error(json?.desc || '保存大模型配置失败');
    return json.data;
  },

  // ================= 语音转写 ASR =================

  // ASR 环境状态（本地 whisper / 云端 GLM 可用性）
  async getAsrStatus(): Promise<AsrStatus> {
    const json = await apiFetch(`${BASE_URL}/asr/status`);
    if (json?.code !== '000000') throw new Error(json?.desc || '读取 ASR 状态失败');
    return json.data;
  },

  // 流式增量转写：传截至当前的完整录音 + 已识别进度，返回新增分段
  async asrLiveTail(audioBase64: string, fromMs: number): Promise<{
    segments: Array<{ startMs: number; endMs: number; text: string }>;
    engine: string | null;
    nextFromMs: number;
  }> {
    const json = await apiFetch(`${BASE_URL}/asr/live`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64, fromMs }),
    });
    if (json?.code !== '000000') throw new Error(json?.desc || '流式转写失败');
    return json.data;
  },

  // 连通性测试（可传 override 测试尚未保存的表单值）
  async testLlm(providerId?: string, override?: { apiKey?: string; baseUrl?: string; model?: string }): Promise<{ ok: boolean; model: string; reply: string }> {
    const json = await apiFetch(`${BASE_URL}/llm/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, override }),
    });
    if (json?.code !== '000000') throw new Error(json?.desc || '连通测试失败');
    return json.data;
  },

  // 自动拉取服务商可用模型列表
  async getLlmModels(providerId?: string, override?: { apiKey?: string; baseUrl?: string }): Promise<LlmModelList> {
    const json = await apiFetch(`${BASE_URL}/llm/models`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ providerId, override }),
    });
    if (json?.code !== '000000') throw new Error(json?.desc || '拉取模型列表失败');
    return json.data;
  },

  // Sign in with ChatGPT：发起 OAuth 登录，返回授权链接
  async startChatGptLogin(): Promise<{ authUrl: string }> {
    const json = await apiFetch(`${BASE_URL}/llm/chatgpt/login`, { method: 'POST' });
    if (json?.code !== '000000') throw new Error(json?.desc || '发起 ChatGPT 登录失败');
    return json.data;
  },

  // 查询 ChatGPT 登录状态
  async getChatGptStatus(): Promise<ChatGptLoginStatus> {
    const json = await apiFetch(`${BASE_URL}/llm/chatgpt/status`);
    if (json?.code !== '000000') throw new Error(json?.desc || '查询 ChatGPT 状态失败');
    return json.data;
  },

  // 退出 ChatGPT 登录
  async logoutChatGpt(): Promise<void> {
    const json = await apiFetch(`${BASE_URL}/llm/chatgpt/logout`, { method: 'POST' });
    if (json?.code !== '000000') throw new Error(json?.desc || '退出 ChatGPT 失败');
  },

  // ================= 讯飞智能办公本真实云端互通 =================

  // 账号登录
  async loginNotebook(mobile: string, password: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/notebook/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, password }),
    });
    const json = await res.json();
    if (json.code !== '000000') {
      throw new Error(json.desc || '登录失败');
    }
    return json.data;
  },

  // 配置 Token
  async setNotebookToken(token: string): Promise<void> {
    const res = await fetch(`${BASE_URL}/notebook/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const json = await res.json();
    if (json.code !== '000000') {
      throw new Error(json.desc || '设置 Token 失败');
    }
  },

  // 退出登录
  async logoutNotebook(): Promise<void> {
    await fetch(`${BASE_URL}/notebook/logout`, { method: 'POST' });
  },

  // 拉取绑定的办公本硬件设备（真实环境）
  async getNotebookDevices(): Promise<{ authenticated: boolean; devices: OfficeNotebookDevice[]; error?: string }> {
    try {
      const json = await apiFetch(`${BASE_URL}/notebook/devices`);
      if (json && json.data) {
        return json.data;
      }
    } catch (_) {}
    return { authenticated: false, devices: [] };
  },

  // 拉取云端笔记列表（真实环境）
  async getNotebookNotes(pageIndex = 1, pageSize = 20): Promise<{ authenticated: boolean; total: number; list: OfficeNotebookNote[] }> {
    try {
      const json = await apiFetch(`${BASE_URL}/notebook/notes?pageIndex=${pageIndex}&pageSize=${pageSize}`);
      if (json && json.data) {
        return json.data;
      }
    } catch (_) {}
    return { authenticated: false, total: 0, list: [] };
  },

  // 拉取单篇办公本笔记的真实详情（正文 + 录音 URL + 句子）
  async getNotebookNoteDetail(noteId: string): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/notes/${encodeURIComponent(noteId)}`);
    if (json.code !== '000000') {
      throw new Error(json.desc || '获取笔记详情失败');
    }
    return json.data;
  },

  // 下载办公本附件至项目自有缓存；不会持久化临时 OSS 签名链接
  async downloadNotebookNote(noteId: string, options: { force?: boolean; includeTranscript?: boolean } = {}): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/notes/${encodeURIComponent(noteId)}/download`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options),
    });
    if (json?.code !== '000000') {
      const error = new Error(json?.desc || '下载办公本附件失败') as Error & { detail?: any };
      error.detail = json?.detail;
      throw error;
    }
    return json.data;
  },

  // 只将已经验证缓存的云笔记导入项目自有会议库，按 noteId 幂等
  async importNotebookNote(noteId: string): Promise<Meeting> {
    const json = await apiFetch(`${BASE_URL}/notebook/notes/${encodeURIComponent(noteId)}/import`, {
      method: 'POST',
    });
    if (json?.code !== '000000') {
      const error = new Error(json?.desc || '导入办公本笔记失败') as Error & { detail?: any };
      error.detail = json?.detail;
      throw error;
    }
    return json.data;
  },

  // 本地删除会议（软删除 + 级联清理）
  async deleteMeeting(meetingId: string): Promise<{ success: boolean; recordId: string }> {
    const res = await fetch(`${BASE_URL}/meetings/${encodeURIComponent(meetingId)}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (json.code !== '000000') {
      throw new Error(json.desc || '删除失败');
    }
    return json.data;
  },

  // 推送到办公本（双目标）：读写驿站 ← 纪要全文 DOCX；办公本笔记 ← 录音笔记（录音 + 纪要全文文字）
  async pushSummaryToNotebook(meetingId: string, targets?: Array<'fileport' | 'record'>): Promise<NotebookPushResponse> {
    const res = await fetch(`${BASE_URL}/notebook/push-summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, targets }),
    });
    const json = await res.json();
    if (json.code !== '000000') {
      const err: any = new Error(json.desc || '推送至办公本失败');
      err.results = json.detail?.results || null;
      throw err;
    }
    return json.data;
  },

  // 录音笔记推送授权（一次性输入讯飞账号密码，建立官方 CLI 作用域会话）
  async getRecordPushAuth(): Promise<{ authorized: boolean; savedAt: string | null }> {
    const res = await fetch(`${BASE_URL}/notebook/record-auth`);
    const json = await res.json();
    return json.data;
  },

  async authorizeRecordPush(password: string): Promise<{ authorized: boolean; savedAt: string | null }> {
    const res = await fetch(`${BASE_URL}/notebook/record-auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const json = await res.json();
    if (json.code !== '000000') throw new Error(json.desc || '授权失败');
    return json.data;
  },

  // 硬件综合状态
  async getDevicesStatus(): Promise<DevicesStatusResponse> {
    const res = await fetch(`${BASE_URL}/devices/status`);
    const json = await res.json();
    return json.data;
  },

  // ============== 微信扫码登录主路径 ==============

  // 申请 PC 扫码登录 URL
  async getNotebookCliLoginUrl(): Promise<{ tempToken: string; qrUrl?: string; qrContent?: string; callbackUrl?: string }> {
    const res = await fetch(`${BASE_URL}/notebook/cli-login/url`, { method: 'POST' });
    const json = await res.json();
    if (json.code !== '000000') throw new Error(json.desc || '申请扫码登录 URL 失败');
    return json.data;
  },

  // 轮询扫码结果
  async pollNotebookCliLogin(tempToken: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/notebook/cli-login/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken })
    });
    const json = await res.json();
    if (json.code !== '000000') throw new Error(json.desc || '查询扫码结果失败');
    return json.data;
  },

  // 查询扫码状态
  async getNotebookCliStatus(tempToken: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/notebook/cli-login/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken })
    });
    const json = await res.json();
    if (json.code !== '000000') throw new Error(json.desc || '查询扫码状态失败');
    return json.data;
  },

  // 用 web code 换取最终 userToken
  async exchangeNotebookCliToken(code: string): Promise<any> {
    const res = await fetch(`${BASE_URL}/notebook/cli-login/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code })
    });
    const json = await res.json();
    if (json.code !== '000000') throw new Error(json.desc || '换取 token 失败');
    return json.data;
  },

  // ============== 回收站 + 云端真删除 ==============

  async recycleNoteOnCloud(noteId: string): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/notes/${encodeURIComponent(noteId)}/recycle`, { method: 'POST' });
    if (json.code !== '000000') throw new Error(json.desc || '移入回收站失败');
    return json.data;
  },

  async deleteNoteFromCloud(noteId: string): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/notes/${encodeURIComponent(noteId)}`, { method: 'DELETE' });
    if (json.code !== '000000') throw new Error(json.desc || '云端删除失败');
    return json.data;
  },

  async getRecycleList(): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/recycle`);
    if (json.code !== '000000') throw new Error(json.desc || '读取回收站失败');
    return json.data;
  },

  async recoverRecycleNotes(noteIds: string[]): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/recycle/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ noteIds })
    });
    if (json.code !== '000000') throw new Error(json.desc || '恢复失败');
    return json.data;
  },

  // ============== 标签 / 目录 / 日程 / 待办 ==============

  async getNotebookTags(): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/tags`);
    if (json.code !== '000000') throw new Error(json.desc || '读取标签失败');
    return json.data;
  },

  async getNotebookDirs(): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/dirs`);
    if (json.code !== '000000') throw new Error(json.desc || '读取目录失败');
    return json.data;
  },

  async getNotebookSchedules(startTime?: number, endTime?: number): Promise<any> {
    const qs = new URLSearchParams();
    if (startTime) qs.set('startTime', String(startTime));
    if (endTime) qs.set('endTime', String(endTime));
    const json = await apiFetch(`${BASE_URL}/notebook/schedules?${qs.toString()}`);
    if (json.code !== '000000') throw new Error(json.desc || '读取日程失败');
    return json.data;
  },

  async getNotebookThings(): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/things`);
    if (json.code !== '000000') throw new Error(json.desc || '读取待办失败');
    return json.data;
  },

  async toggleCloudThing(thingId: string, done: boolean): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/things/${encodeURIComponent(thingId)}/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done })
    });
    if (json.code !== '000000') throw new Error(json.desc || '切换待办失败');
    return json.data;
  },

  // ============== 分享 ==============

  async shareNoteToCloud(noteId: string, payload: { type: number; days?: number; restricted?: number; code?: string }): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/notes/${encodeURIComponent(noteId)}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (json.code !== '000000') throw new Error(json.desc || '分享失败');
    return json.data;
  },

  // ============== FilePort 推送历史 ==============

  async getFilePortList(): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/fileports`);
    if (json.code !== '000000') throw new Error(json.desc || '读取推送历史失败');
    return json.data;
  },

  async deleteFilePort(filePortId: string): Promise<any> {
    const json = await apiFetch(`${BASE_URL}/notebook/fileports/${encodeURIComponent(filePortId)}`, { method: 'DELETE' });
    if (json.code !== '000000') throw new Error(json.desc || '删除推送历史失败');
    return json.data;
  }
};
