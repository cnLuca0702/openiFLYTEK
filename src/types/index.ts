export interface Sentence {
  id: string;
  speaker: string;
  time: string;
  startTimeMs?: number;
  endTimeMs?: number;
  text: string;
  trans?: string;
}

export interface TodoItem {
  id: string;
  task: string;
  done: boolean;
  owner?: string;
}

export interface AiSummary {
  generated: boolean;
  title: string;
  abstract: string;
  summaryFull?: string;
  topics: string[];
  todos: TodoItem[];
}

export interface Meeting {
  id: string;
  source?: 'viaim' | 'notebook' | 'recording';
  cloudNoteId?: string;
  title: string;
  subtitle?: string;
  createdAt: string;
  duration: string;
  durationMs?: number;
  category: string;
  audioSource: string;
  status: 'recording' | 'completed' | 'syncing';
  speakerCount: number;
  hasAudio: boolean;
  audioUrl?: string | null;
  audioState?: 'none' | 'not_downloaded' | 'downloading' | 'ready' | 'failed' | 'partial';
  sentenceCount?: number;
  todoCount?: number;
  hasSummary?: boolean;
  sentences: Sentence[];
  aiSummary: AiSummary;
}

export interface LlmProviderMeta {
  id: string;
  label: string;
  kind: 'openai-compatible' | 'chatgpt-oauth';
  requiresApiKey: boolean;
  defaultBaseUrl: string;
  defaultModel: string;
  custom?: boolean;
  description?: string;
}

export interface LlmProviderConfigView {
  apiKeySet: boolean;
  apiKeyMasked: string;
  baseUrl: string;
  model: string;
}

export interface AsrConfig {
  mode: 'local' | 'online' | 'stream';
  priority: 'local' | 'online';
}

export interface AsrStatus {
  local: { available: boolean; cli: boolean; model: string };
  online: { available: boolean };
}

export interface LlmPublicConfig {
  provider: string;
  autoSummary: boolean;
  providers: Record<string, LlmProviderConfigView>;
  asr?: AsrConfig;
  chatgpt: { loggedIn: boolean; email: string; accountId: string };
}

export interface ChatGptLoginStatus {
  loggedIn: boolean;
  email: string;
  accountId: string;
  pending: boolean;
  error: string | null;
}

export interface LlmModelList {
  models: string[];
  source: 'remote' | 'builtin';
}

export interface OfficeNotebookDevice {
  deviceId: string;
  deviceName: string;
  deviceModel: string;
  osVersion: string;
  lastLoginTime: string;
  battery?: number;
  isOnline: boolean;
  connected?: boolean;
  authenticated?: boolean;
  /** 云端会话是否真实可用（服务端实际调用接口校验，而非仅检查本地 token） */
  sessionValid?: boolean;
  sessionReason?: string;
}

export interface OfficeNotebookNote {
  noteId: string;
  title: string;
  createTime: number;
  updateTime: number;
  isEncrypt: number;
  hasAudio: boolean;
  audioDuration: string;
  summary: string;
  type?: number;
  typeLabel?: string;
  downloadState?: 'not_downloaded' | 'downloading' | 'ready' | 'failed' | 'partial';
}

export interface UserProfile {
  userName: string;
  phone: string;
  userId?: string;
  avatar: string;
  hasDongle: boolean;
  dongleModel?: string;
  headsetName?: string;
}

export interface ViaimDeviceStatus {
  connected: boolean;
  name: string;
  dongleConnected: boolean;
  dongleModel?: string;
  batteryLeft: number;
  batteryRight: number;
  batteryCase: number;
  aecActive: boolean;
  mode: string;
}

export interface DevicesStatusResponse {
  user?: UserProfile;
  viaimHeadset: ViaimDeviceStatus;
  officeNotebook: OfficeNotebookDevice;
}
