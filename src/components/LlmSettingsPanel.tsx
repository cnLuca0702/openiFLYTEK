import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyRound,
  Link2,
  Loader2,
  PlugZap,
  ExternalLink,
  LogIn,
  LogOut,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  RefreshCw,
  Cpu,
} from 'lucide-react';
import { EmbeddingSettings } from './EmbeddingSettings';
import { api } from '../services/api';
import { useToast } from '../hooks/useToast';
import { LlmProviderMeta, LlmPublicConfig, ChatGptLoginStatus } from '../types';

interface LlmSettingsPanelProps {
  onConfigChange?: (config: LlmPublicConfig) => void;
}

const EMPTY_VIEW = { apiKeySet: false, apiKeyMasked: '', baseUrl: '', model: '' };

function openExternal(url: string) {
  const electron = (window as any).electronAPI;
  if (electron?.openExternal) {
    electron.openExternal(url);
  } else {
    window.open(url, '_blank');
  }
}

export const LlmSettingsPanel: React.FC<LlmSettingsPanelProps> = ({ onConfigChange }) => {
  const toast = useToast();
  const [providers, setProviders] = useState<LlmProviderMeta[]>([]);
  const [config, setConfig] = useState<LlmPublicConfig | null>(null);
  const [activeId, setActiveId] = useState<string>('');
  const [form, setForm] = useState<{ apiKey: string; baseUrl: string; model: string }>({
    apiKey: '',
    baseUrl: '',
    model: '',
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [chatgptStatus, setChatgptStatus] = useState<ChatGptLoginStatus | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyConfig = useCallback(
    (next: LlmPublicConfig) => {
      setConfig(next);
      onConfigChange?.(next);
    },
    [onConfigChange]
  );

  const syncForm = useCallback(
    (providerId: string, metaList: LlmProviderMeta[], cfg: LlmPublicConfig) => {
      const view = cfg.providers[providerId] || EMPTY_VIEW;
      const meta = metaList.find((p) => p.id === providerId);
      setForm({
        apiKey: '',
        baseUrl: view.baseUrl || '',
        model: view.model || meta?.defaultModel || '',
      });
    },
    []
  );

  const loadAll = useCallback(async () => {
    try {
      const [metaList, cfg, status] = await Promise.all([
        api.getLlmProviders(),
        api.getLlmConfig(),
        api.getChatGptStatus(),
      ]);
      setProviders(metaList);
      applyConfig(cfg);
      setChatgptStatus(status);
      const initial = cfg.provider || metaList[0]?.id || '';
      setActiveId(initial);
      syncForm(initial, metaList, cfg);
    } catch (err: any) {
      toast.error(err?.message || '读取大模型配置失败', { title: '大模型引擎' });
    }
  }, [applyConfig, syncForm, toast]);

  useEffect(() => {
    loadAll();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadAll]);

  const activeMeta = providers.find((p) => p.id === activeId) || null;
  const activeView = (config?.providers || {})[activeId] || EMPTY_VIEW;
  const isChatGpt = activeMeta?.kind === 'chatgpt-oauth';

  const handleSelectProvider = async (id: string) => {
    setActiveId(id);
    setTestResult(null);
    setModelOptions([]);
    if (providers.length && config) syncForm(id, providers, config);
    // 选中即设为当前使用的引擎
    if (config && id !== config.provider) {
      try {
        const next = await api.saveLlmConfig({ provider: id });
        applyConfig(next);
      } catch (err: any) {
        toast.error(err?.message || '切换引擎失败', { title: '大模型引擎' });
      }
    }
  };

  const handleSaveProvider = async () => {
    if (!activeId) return;
    if (!form.baseUrl.trim() && !activeMeta?.defaultBaseUrl) {
      toast.warning('请先填写 Base URL', { title: '大模型引擎' });
      return;
    }
    if (!form.model.trim()) {
      toast.warning('请先拉取或填写模型名称', { title: '大模型引擎' });
      return;
    }
    setIsSaving(true);
    setTestResult(null);
    try {
      const next = await api.saveLlmConfig({
        provider: activeId,
        providerId: activeId,
        providerConfig: {
          ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
          baseUrl: form.baseUrl.trim(),
          model: form.model.trim(),
        },
      });
      applyConfig(next);
      syncForm(activeId, providers, next);
      toast.success(`「${activeMeta?.label || activeId}」配置已保存，正在验证连通性…`, { title: '大模型引擎' });
    } catch (err: any) {
      toast.error(err?.message || '保存配置失败', { title: '大模型引擎' });
      setIsSaving(false);
      return;
    }
    setIsSaving(false);
    // 保存后立即对“设定的模型”执行连通测试
    await handleTest();
  };

  const handleFetchModels = async () => {
    if (!activeId) return;
    setIsFetchingModels(true);
    setTestResult(null);
    try {
      const result = await api.getLlmModels(activeId, {
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
      });
      setModelOptions(result.models);
      // ChatGPT 登录后必须由用户显式选择模型，不自动填第一个
      if (!isChatGpt && !form.model.trim() && result.models[0]) {
        setForm((f) => ({ ...f, model: result.models[0] }));
      }
      toast.success(
        result.source === 'builtin'
          ? `已载入内置模型清单（${result.models.length} 个）`
          : `已拉取 ${result.models.length} 个可用模型`,
        { title: '模型列表' }
      );
    } catch (err: any) {
      toast.error(err?.message || '拉取模型列表失败', { title: '模型列表', duration: 7000 });
    } finally {
      setIsFetchingModels(false);
    }
  };

  const handleTest = async () => {
    if (!activeId) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const result = await api.testLlm(activeId, {
        ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
        ...(form.baseUrl.trim() ? { baseUrl: form.baseUrl.trim() } : {}),
        ...(form.model.trim() ? { model: form.model.trim() } : {}),
      });
      setTestResult({ ok: true, message: `连通正常（${result.model}）：${result.reply}` });
      toast.success('大模型连通测试通过', { title: '连通测试' });
    } catch (err: any) {
      setTestResult({ ok: false, message: err?.message || '连通测试失败' });
      toast.error(err?.message || '连通测试失败', { title: '连通测试', duration: 7000 });
    } finally {
      setIsTesting(false);
    }
  };

  const stopPolling = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  const handleChatGptLogin = async () => {
    try {
      setIsLoggingIn(true);
      const { authUrl } = await api.startChatGptLogin();
      openExternal(authUrl);
      toast.info('已打开浏览器，请在页面中完成 ChatGPT 授权。', { title: 'Sign in with ChatGPT', duration: 6000 });

      stopPolling();
      const startedAt = Date.now();
      pollRef.current = setInterval(async () => {
        if (Date.now() - startedAt > 180000) {
          stopPolling();
          setIsLoggingIn(false);
          toast.warning('授权等待超时，请重新发起登录。', { title: 'Sign in with ChatGPT' });
          return;
        }
        try {
          const status = await api.getChatGptStatus();
          setChatgptStatus(status);
          if (status.loggedIn) {
            stopPolling();
            setIsLoggingIn(false);
            toast.success(`已登录 ChatGPT${status.email ? `：${status.email}` : ''}，请选择要使用的模型`, { title: 'Sign in with ChatGPT' });
            handleFetchModels();
          } else if (status.error) {
            stopPolling();
            setIsLoggingIn(false);
            toast.error(status.error, { title: 'Sign in with ChatGPT', duration: 8000 });
          }
        } catch (_) {
          /* 轮询失败忽略，下次再试 */
        }
      }, 2000);
    } catch (err: any) {
      setIsLoggingIn(false);
      toast.error(err?.message || '发起 ChatGPT 登录失败', { title: 'Sign in with ChatGPT' });
    }
  };

  const handleChatGptLogout = async () => {
    try {
      await api.logoutChatGpt();
      setChatgptStatus({ loggedIn: false, email: '', accountId: '', pending: false, error: null });
      toast.info('已退出 ChatGPT 登录', { title: 'Sign in with ChatGPT' });
    } catch (err: any) {
      toast.error(err?.message || '退出失败', { title: 'Sign in with ChatGPT' });
    }
  };

  const handleToggleAutoSummary = async (value: boolean) => {
    if (!config) return;
    const prev = config;
    applyConfig({ ...config, autoSummary: value });
    try {
      const next = await api.saveLlmConfig({ autoSummary: value });
      applyConfig(next);
    } catch (err: any) {
      applyConfig(prev);
      toast.error(err?.message || '保存失败', { title: '大模型引擎' });
    }
  };

  // 模型选择（各服务商共用；ChatGPT 登录后同样必须由用户显式选择，不设默认模型）
  const modelField = (
    <label className="block space-y-1">
      <span className="text-[11px] text-viaim-textMuted flex items-center gap-1">
        <Sparkles className="w-3 h-3" /> 模型名称
        <button
          type="button"
          onClick={handleFetchModels}
          disabled={isFetchingModels}
          className="ml-auto text-[10px] text-indigo-600 hover:text-indigo-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
          title="从服务商自动拉取可用模型列表"
        >
          {isFetchingModels ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
          拉取模型列表
        </button>
      </span>
      <input
        type="text"
        list="llm-model-options"
        value={form.model}
        onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
        placeholder={activeMeta?.defaultModel || 'model-name'}
        className="w-full bg-slate-800 border border-viaim-border rounded-lg px-2.5 py-1.5 text-xs text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-viaim-primary"
      />
      <datalist id="llm-model-options">
        {modelOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {modelOptions.length > 0 && (
        <span className="text-[10px] text-viaim-textDim">
          已拉取 {modelOptions.length} 个模型，可下拉选择或手动输入
        </span>
      )}
    </label>
  );

  return (
    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-viaim-border space-y-3">
      <h3 className="font-bold text-viaim-textMain flex items-center gap-1.5">
        <Cpu className="w-4 h-4 text-viaim-primary" />
        <span>大模型 LLM 设置（用户自配置）</span>
      </h3>

      <EmbeddingSettings />
      {/* 服务商选择 */}
      <div className="grid grid-cols-3 gap-1.5">
        {providers.map((p) => {
          const selected = p.id === activeId;
          const isEngine = config?.provider === p.id;
          return (
            <button
              key={p.id}
              onClick={() => handleSelectProvider(p.id)}
              className={`relative px-2 py-2 rounded-lg text-[11px] font-semibold border transition-all cursor-pointer ${
                selected
                  ? 'bg-viaim-primary/20 border-viaim-primary/60 text-viaim-primary'
                  : 'bg-slate-800/60 border-viaim-border text-viaim-textMuted hover:text-viaim-textMain hover:border-slate-600'
              }`}
              title={p.description}
            >
              {isEngine && (
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
              )}
              {p.label}
            </button>
          );
        })}
      </div>

      {activeMeta && (
        <div className="space-y-2.5 pt-2 border-t border-viaim-border/50">
          <p className="text-[11px] text-viaim-textDim leading-relaxed">{activeMeta.description}</p>

          {isChatGpt ? (
            /* Sign in with ChatGPT */
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2.5 rounded-lg bg-slate-800/50 border border-viaim-border">
                <div className="flex items-center gap-2 text-xs">
                  {chatgptStatus?.loggedIn ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-600" />
                  )}
                  <div>
                    <p className="text-viaim-textMain font-medium">
                      {chatgptStatus?.loggedIn ? '已登录' : '未登录'}
                    </p>
                    {chatgptStatus?.email && (
                      <p className="text-[10px] text-viaim-textDim font-mono">{chatgptStatus.email}</p>
                    )}
                  </div>
                </div>
                {chatgptStatus?.loggedIn ? (
                  <button
                    onClick={handleChatGptLogout}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-viaim-textMain text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer"
                  >
                    <LogOut className="w-3 h-3" />
                    退出
                  </button>
                ) : (
                  <button
                    onClick={handleChatGptLogin}
                    disabled={isLoggingIn}
                    className="px-2.5 py-1 rounded-lg bg-viaim-primary hover:bg-viaim-primaryHover text-white text-[11px] font-semibold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    {isLoggingIn ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <LogIn className="w-3 h-3" />
                    )}
                    {isLoggingIn ? '等待授权...' : 'Sign in with ChatGPT'}
                  </button>
                )}
              </div>
              <p className="text-[10px] text-viaim-textDim">
                使用 ChatGPT Plus / Pro 账号授权，无需 API Key。授权将跳转浏览器完成，支持随时退出。
              </p>
              {modelField}
            </div>
          ) : (
            /* OpenAI 兼容服务商 */
            <div className="space-y-2">
              <label className="block space-y-1">
                <span className="text-[11px] text-viaim-textMuted flex items-center gap-1">
                  <Link2 className="w-3 h-3" /> Base URL
                </span>
                <input
                  type="text"
                  value={form.baseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
                  placeholder={activeMeta.defaultBaseUrl || 'https://your-endpoint/v1'}
                  className="w-full bg-slate-800 border border-viaim-border rounded-lg px-2.5 py-1.5 text-xs text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-viaim-primary"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-[11px] text-viaim-textMuted flex items-center gap-1">
                  <KeyRound className="w-3 h-3" /> API Key
                  {activeView.apiKeySet && (
                    <span className="text-emerald-600/80 font-mono text-[10px]">
                      已保存 {activeView.apiKeyMasked}
                    </span>
                  )}
                </span>
                <input
                  type="password"
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                  placeholder={activeView.apiKeySet ? '留空则保持已保存的 Key 不变' : '请输入 API Key'}
                  autoComplete="off"
                  className="w-full bg-slate-800 border border-viaim-border rounded-lg px-2.5 py-1.5 text-xs text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-viaim-primary"
                />
              </label>

              {modelField}
            </div>
          )}

          {/* 操作区 */}
          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={handleSaveProvider}
              disabled={isSaving || isTesting}
              className="px-3 py-1.5 rounded-lg bg-viaim-primary hover:bg-viaim-primaryHover text-white text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
              保存配置
            </button>
            <button
              onClick={handleTest}
              disabled={isTesting || isSaving}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-viaim-textMain text-[11px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-60"
            >
              {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <PlugZap className="w-3 h-3" />}
              {isTesting ? '测试中...' : '连通测试'}
            </button>
            {config?.provider !== activeId && (
              <span className="text-[10px] text-amber-600/90 flex items-center gap-1 ml-auto">
                <ExternalLink className="w-3 h-3" /> 非当前引擎
              </span>
            )}
          </div>

          {testResult && (
            <div
              className={`p-2 rounded-lg text-[11px] leading-relaxed border ${
                testResult.ok
                  ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-700'
                  : 'bg-red-950/30 border-red-500/40 text-red-600'
              }`}
            >
              {testResult.ok ? '✓ ' : '✗ '}
              {testResult.message}
            </div>
          )}
        </div>
      )}

      {/* 自动提炼开关 */}
      <div className="flex items-center justify-between pt-2 border-t border-viaim-border/50">
        <div>
          <p className="text-viaim-textMain font-medium">录制结束后自动提炼 AI 纪要</p>
          <p className="text-[11px] text-viaim-textDim">会议停止后由当前大模型自动生成核心结论与待办</p>
        </div>
        <input
          type="checkbox"
          checked={config?.autoSummary ?? true}
          onChange={(e) => handleToggleAutoSummary(e.target.checked)}
          className="w-4 h-4 accent-viaim-primary cursor-pointer"
        />
      </div>
    </div>
  );
};
