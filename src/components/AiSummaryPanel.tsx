import { AutomaticFollowup } from './AutomaticFollowup';
import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Tablet,
  CheckSquare,
  ListOrdered,
  Send,
  FileCheck,
  Bot,
  ArrowRight,
  RefreshCw,
  Wifi,
  BatteryCharging,
  AlertCircle,
  LogIn,
  LayoutTemplate,
  AtSign,
  X,
  Cpu
} from 'lucide-react';
import { MemoryState } from './MemoryState';
import { Meeting, OfficeNotebookDevice } from '../types';
import { api, MemoryCitation, MemoryProject } from '../services/api';

interface AiSummaryPanelProps {
  meeting: Meeting | null;
  meetings: Meeting[];
  onOpenMemory: (citation: MemoryCitation) => Promise<void>;
  onGenerateAiSummary: (options?: { force?: boolean }) => void;
  isGeneratingAi: boolean;
  onToggleTodo: (todoId: string) => void;
  onPushToNotebook: () => void;
  isPushing: boolean;
  isPushed: boolean;
  pushedResult: any;
  notebookDevice: OfficeNotebookDevice | null;
  isQuickBarOpen: boolean;
  onToggleQuickBar: () => void;
}

export const AiSummaryPanel: React.FC<AiSummaryPanelProps> = ({
  meeting,
  meetings,
  onOpenMemory,
  onGenerateAiSummary,
  isGeneratingAi,
  onToggleTodo,
  onPushToNotebook,
  isPushing,
  isPushed,
  pushedResult,
  notebookDevice,
  isQuickBarOpen,
  onToggleQuickBar
}) => {
  const [activeTab, setActiveTab] = useState<'summary' | 'notebook' | 'chat'>('chat');
  const [chatInput, setChatInput] = useState('');
  const [relatedMemories, setRelatedMemories] = useState<MemoryCitation[]>([]);
  const [memoryError, setMemoryError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setRelatedMemories([]);
    setMemoryError('');
    if (activeTab === 'summary' && meeting?.id) {
      api.relatedMemories(meeting.id).then((items) => { if (!cancelled) setRelatedMemories(items); }).catch(() => {});
    }
    return () => { cancelled = true; };
  }, [activeTab, meeting?.id, meeting?.aiSummary?.summaryFull]);
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');

  const handleAuthorizeRecordPush = async () => {
    if (!authPassword) return;
    setAuthBusy(true);
    setAuthError('');
    try {
      await api.authorizeRecordPush(authPassword);
      setAuthPassword('');
      onPushToNotebook();
    } catch (err: any) {
      setAuthError(err?.message || '授权失败');
    } finally {
      setAuthBusy(false);
    }
  };
  const [chatMessages, setChatMessages] = useState<Array<{ role: 'user' | 'assistant'; content: string; citations?: MemoryCitation[]; projects?: MemoryProject[]; memoryWarnings?: string[] }>>([
    { role: 'assistant', content: '您好！我是 OpeniFLYTEK 会议 AI 助手。\n\n直接提问，我会自动查找会议和文档并提供原文来源。输入 @ 可限定会议范围。会议会在后台自动整理为记忆，无需手动收录。' }
  ]);
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // @ 触发中的检索词
  const [mentionedMeetings, setMentionedMeetings] = useState<Meeting[]>([]); // 已选上下文录音
  const [modelOptions, setModelOptions] = useState<Array<{ key: string; providerId: string; model: string; label: string }>>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string>('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatBodyRef = useRef<HTMLDivElement | null>(null);
  const chatInputRef = useRef<HTMLInputElement | null>(null);

  // 加载用户已配置的模型（providers 中 model 已设置的项）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [cfg, providerMetas] = await Promise.all([
          api.getLlmConfig(),
          api.getLlmProviders().catch(() => [] as Array<{ id: string; label: string }>)
        ]);
        if (cancelled) return;
        const labelOf = (id: string) => providerMetas.find((p: any) => p.id === id)?.label || id;
        const options: Array<{ key: string; providerId: string; model: string; label: string }> = [];
        for (const [pid, meta] of Object.entries(cfg.providers || {})) {
          const model = (meta as any)?.model;
          const apiKeySet = (meta as any)?.apiKeySet;
          const isChatGpt = pid === 'chatgpt';
          const usable = isChatGpt ? !!cfg.chatgpt?.loggedIn && !!model : apiKeySet && !!model;
          if (model && usable) {
            options.push({ key: `${pid}::${model}`, providerId: pid, model, label: `${labelOf(pid)} · ${model}` });
          }
        }
        setModelOptions(options);
        if (options.length && !options.some((o) => o.key === selectedModelKey)) {
          setSelectedModelKey(options[0].key);
        }
      } catch (_) { /* 未配置模型时选择器显示空态 */ }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 聊天窗口自动滚动到底部
  useEffect(() => {
    if (chatBodyRef.current) {
      chatBodyRef.current.scrollTop = chatBodyRef.current.scrollHeight;
    }
  }, [chatMessages, isChatLoading]);

  const mentionCandidates = mentionQuery === null
    ? []
    : meetings
        .filter((m) => !mentionedMeetings.some((s) => s.id === m.id))
        .filter((m) => {
          const q = mentionQuery.trim().toLowerCase();
          return !q || m.title.toLowerCase().includes(q);
        })
        .slice(0, 6);

  const handleChatInputChange = (value: string) => {
    setChatInput(value);
    // 检测光标前未闭合的 @token
    const match = value.match(/@([^@\s]*)$/);
    setMentionQuery(match ? match[1] : null);
  };

  const pickMention = (m: Meeting) => {
    setMentionedMeetings((prev) => (prev.some((s) => s.id === m.id) ? prev : [...prev, m]));
    setChatInput((prev) => prev.replace(/@([^@\s]*)$/, ''));
    setMentionQuery(null);
    chatInputRef.current?.focus();
  };

  const removeMention = (id: string) => {
    setMentionedMeetings((prev) => prev.filter((m) => m.id !== id));
  };

  const handleSendChat = async () => {
    const q = chatInput.trim();
    if (!q || isChatLoading) return;
    const chosen = modelOptions.find((o) => o.key === selectedModelKey);
    const displayQuestion = mentionedMeetings.map((m) => `@《${m.title}》`).join(' ') + ' ' + q;

    setChatMessages((prev) => [...prev, { role: 'user', content: displayQuestion }]);
    setChatInput('');
    setMentionQuery(null);
    setIsChatLoading(true);
    try {
      const result = await api.aiChat({
        question: q,
        currentMeetingId: meeting?.id,
        meetingIds: mentionedMeetings.map((m) => m.id),
        providerId: chosen?.providerId,
        model: chosen?.model
      });
      setChatMessages((prev) => [...prev, { role: 'assistant', content: result.answer || '（模型未返回内容，请重试或更换模型）', citations: result.citations, projects: result.projects, memoryWarnings: result.memoryWarnings }]);
    } catch (err: any) {
      setChatMessages((prev) => [...prev, { role: 'assistant', content: `问答失败：${err?.message || '未知错误'}` }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  const summary = meeting?.aiSummary;

  return (
    <aside className="w-full h-full border-l border-viaim-border bg-viaim-card/70 backdrop-blur-md flex flex-col shrink-0 select-none">
      {/* 次入口：与顶栏「快捷录音」同义，保留兼容 */}
      <div className="shrink-0 p-2 border-b border-viaim-border bg-viaim-bg/40">
        <button
          onClick={onToggleQuickBar}
          className={`w-full h-8 px-3 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
            isQuickBarOpen
              ? 'bg-viaim-primary/15 border-viaim-primary/50 text-indigo-300'
              : 'bg-viaim-card border-viaim-border text-viaim-textMuted hover:bg-viaim-cardHover hover:text-viaim-textMain'
          }`}
          title="打开 / 收起快捷录音胶囊（收起不停录）"
        >
          <LayoutTemplate className="w-3.5 h-3.5" />
          <span>{isQuickBarOpen ? '收起快捷胶囊' : '快捷录音胶囊'}</span>
        </button>
      </div>

      {/* 选项卡头部 */}
      <div className="flex items-center border-b border-viaim-border p-1 bg-viaim-bg/60 text-xs shrink-0">
        <button
          onClick={() => setActiveTab('summary')}
          className={`flex-1 py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'summary'
              ? 'bg-viaim-primary/20 text-indigo-300 shadow-sm border border-viaim-primary/40'
              : 'text-viaim-textDim hover:text-viaim-textMain'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>AI 会议大脑</span>
        </button>

        <button
          onClick={() => setActiveTab('notebook')}
          className={`flex-1 py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'notebook'
              ? 'bg-amber-500/20 text-amber-600 shadow-sm border border-amber-500/40'
              : 'text-viaim-textDim hover:text-viaim-textMain'
          }`}
        >
          <Tablet className="w-3.5 h-3.5 text-amber-600" />
          <span>办公本推屏</span>
        </button>

        <button
          onClick={() => setActiveTab('chat')}
          className={`flex-1 py-2 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            activeTab === 'chat'
              ? 'bg-cyan-500/20 text-cyan-300 shadow-sm border border-cyan-500/40'
              : 'text-viaim-textDim hover:text-viaim-textMain'
          }`}
        >
          <Bot className="w-3.5 h-3.5" />
          <span>AI 问答</span>
        </button>
      </div>

      {/* 选项卡 1：AI 深度纪要与待办 */}
      {activeTab === 'summary' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar select-text">
          {summary?.generated ? (
            <>
              {/* 会议核心总结卡片 */}
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-viaim-primary" />
                    会议核心总结
                  </span>
                  <button
                    onClick={() => onGenerateAiSummary({ force: true })}
                    disabled={isGeneratingAi}
                    className="text-[11px] text-viaim-textDim hover:text-indigo-300 flex items-center gap-1 transition-colors cursor-pointer"
                    title="重新调用大模型提炼（忽略已有结果）"
                  >
                    <RefreshCw className={`w-3 h-3 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                    <span>重新提炼</span>
                  </button>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
                  {summary.abstract || (summary.summaryFull ? summary.summaryFull.substring(0, 200) + '...' : '')}
                </p>
              </div>

              {meeting && <AutomaticFollowup meetingId={meeting.id} onOpen={onOpenMemory} />}
              {relatedMemories.length > 0 && (
                <div className="p-3.5 rounded-xl bg-viaim-card/80 border border-viaim-border space-y-2">
                  <h4 className="text-xs font-bold text-cyan-300">自动关联的历史线索</h4>
                  <p className="text-[10px] text-viaim-textDim">来自其他会议或文档，仅供核对背景，不属于本次决议。</p>
                  {relatedMemories.map((citation) => (
                    <details key={citation.chunkId} className="text-[11px] text-slate-300">
                      <summary className="cursor-pointer">{citation.title} · {citation.occurredAt ? new Date(citation.occurredAt).toLocaleDateString('zh-CN') : '时间未知'}</summary>
                      <p className="whitespace-pre-wrap max-h-40 overflow-auto select-text mt-2">{citation.excerpt}</p>
                      <button className="text-cyan-300 cursor-pointer mt-1" onClick={async () => {
                        try { await onOpenMemory(citation); }
                        catch (err: any) { setMemoryError(err?.message || '来源暂不可读取'); }
                      }}>查看来源</button>
                    </details>
                  ))}
                  {memoryError && <p className="text-xs text-amber-400">{memoryError}</p>}
                </div>
              )}

              {/* 关键议题 */}
              {summary.topics && summary.topics.length > 0 && (
                <div className="p-3.5 rounded-xl bg-viaim-card/80 border border-viaim-border">
                  <h4 className="text-xs font-bold text-viaim-textMain mb-2 flex items-center gap-1.5">
                    <ListOrdered className="w-4 h-4 text-viaim-cyan" />
                    主要议题与讨论
                  </h4>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {summary.topics.map((t, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <span className="w-4 h-4 rounded-full bg-slate-800 text-[10px] flex items-center justify-center shrink-0 font-bold text-viaim-cyan">
                          {i + 1}
                        </span>
                        <span>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* 真实待办事项 Action Items */}
              {summary.todos && summary.todos.length > 0 && (
                <div className="p-3.5 rounded-xl bg-viaim-card/80 border border-viaim-border">
                  <h4 className="text-xs font-bold text-viaim-textMain mb-2 flex items-center gap-1.5">
                    <CheckSquare className="w-4 h-4 text-emerald-600" />
                    行动待办事项 ({summary.todos.length})
                  </h4>
                  <div className="space-y-2">
                    {summary.todos.map((todo) => (
                      <div
                        key={todo.id}
                        onClick={() => onToggleTodo(todo.id)}
                        className={`flex items-start gap-2.5 p-2 rounded-lg border transition-all cursor-pointer ${
                          todo.done
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-viaim-textDim line-through'
                            : 'bg-slate-900/60 border-viaim-border hover:border-slate-600 text-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={todo.done}
                          onChange={() => {}}
                          className="mt-0.5 rounded accent-emerald-500 cursor-pointer"
                        />
                        <div className="flex-1 text-xs">
                          <p>{todo.task}</p>
                          {todo.owner && (
                            <span className="text-[10px] text-indigo-400 font-mono">
                              @{todo.owner}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* 如果包含完整长文总结，可展开浏览 */}
              {summary.summaryFull && (
                <div className="p-3.5 rounded-xl bg-slate-900/70 border border-viaim-border">
                  <h4 className="text-xs font-bold text-viaim-textMain mb-2 flex items-center gap-1.5">
                    <FileCheck className="w-4 h-4 text-indigo-400" />
                    完整会议纪要全文
                  </h4>
                  <div className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line max-h-96 overflow-y-auto custom-scrollbar">
                    {summary.summaryFull}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-center p-6 border border-dashed border-viaim-border rounded-2xl">
              <Sparkles className="w-10 h-10 text-viaim-primary mb-3 opacity-60" />
              <h3 className="text-sm font-semibold text-viaim-textMain mb-1">尚未提炼 AI 纪要</h3>
              <p className="text-xs text-viaim-textDim mb-4">
                点击下方按钮，基于真实实录自动萃取核心摘要、议题与待办事项。
              </p>
              <button
                onClick={() => onGenerateAiSummary()}
                disabled={isGeneratingAi}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-viaim-primary to-indigo-600 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-bold flex items-center gap-2 shadow-glow-primary transition-all cursor-pointer"
              >
                <Sparkles className={`w-4 h-4 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                <span>{isGeneratingAi ? '正在智能提炼中...' : '立即提炼会议纪要'}</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* 选项卡 2：智能办公本推屏联动 */}
      {activeTab === 'notebook' && (
        <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar select-text">
          {/* 设备连接状态卡片 */}
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Tablet className="w-5 h-5 text-amber-600" />
                <span className="font-bold text-sm">
                  {notebookDevice?.deviceName || '科大讯飞智能办公本'}
                </span>
              </div>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex items-center gap-1 ${
                notebookDevice?.connected
                  ? 'bg-emerald-500/20 text-emerald-600 border border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}>
                <Wifi className="w-3 h-3" /> {notebookDevice?.connected ? '在线' : '待连接'}
              </span>
            </div>

            <p className="text-xs text-amber-700/80 mb-3">
              {notebookDevice?.connected 
                ? '已连接讯飞云网关 (api.iflyink.com)，支持免数据线云端一键将会议纪要投递到办公本“读写驿站”。'
                : '请前往办公本中心登录讯飞账号，与您的智能办公本设备建立云端直连。'}
            </p>

            {notebookDevice?.connected && (
              <div className="grid grid-cols-2 gap-2 text-xs text-slate-300 bg-slate-900/60 p-2.5 rounded-lg border border-amber-500/20">
                <div>
                  <span className="text-viaim-textDim text-[11px]">设备型号:</span>
                  <p className="font-mono font-medium">{notebookDevice?.deviceModel || 'X2'}</p>
                </div>
                <div>
                  <span className="text-viaim-textDim text-[11px]">固件系统:</span>
                  <p className="font-mono font-medium">{notebookDevice?.osVersion || 'E-Ink OS'}</p>
                </div>
              </div>
            )}
          </div>

          {/* 一键推送操作面板 */}
          <div className="p-4 rounded-xl bg-viaim-card/80 border border-viaim-border space-y-3">
            <h4 className="text-xs font-bold text-viaim-textMain flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-amber-600" />
              <span>推送到智能办公本</span>
            </h4>
            <div className="text-xs text-viaim-textMuted leading-relaxed space-y-1">
              <p><span className="font-semibold text-viaim-textMain">读写驿站：</span>会议纪要全文（摘要、详细纪要、议题、待办、完整转写），Word 文档格式，办公本可直接打开。</p>
              <p><span className="font-semibold text-viaim-textMain">办公本笔记：</span>生成一条录音笔记，包含会议录音；文字区先显示纪要全文，再显示带时间戳的逐句转写，点句子可跳转播放。</p>
            </div>

            <button
              onClick={onPushToNotebook}
              disabled={isPushing || !meeting}
              className={`w-full py-2.5 px-4 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-lg transition-all cursor-pointer ${
                isPushed
                  ? 'bg-emerald-600/30 text-emerald-600 border border-emerald-500/50'
                  : 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white shadow-amber-500/20'
              }`}
            >
              <Tablet className="w-4 h-4" />
              <span>{isPushing ? '正在直传 OSS 并通知办公本...' : isPushed ? '已成功推送到办公本 (点击再次推送)' : '一键推送到办公本墨水屏'}</span>
              <ArrowRight className="w-3.5 h-3.5 ml-1" />
            </button>

            {pushedResult && (() => {
              const results = pushedResult.results || {};
              const rows: Array<{ label: string; r: any; okText: (r: any) => string }> = [
                { label: '读写驿站', r: results.fileport, okText: (r) => `已推送《${r.fileName}》` },
                { label: '办公本笔记', r: results.record, okText: (r) => r.skipped ? r.reason : `已${r.updated ? '更新' : '创建'}录音笔记（${Math.round((r.durationMs || 0) / 1000)} 秒录音，${r.textEntries} 段文字）` },
              ].filter((x) => x.r);
              const needAuth = !!results.record?.needRecordAuth;
              return (
                <div className="space-y-2">
                  {rows.length === 0 && (
                    <div className="p-2.5 rounded-lg bg-red-950/30 border border-red-500/40 text-[11px] text-red-600 flex items-start gap-1">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <span className="whitespace-pre-line">{pushedResult.message}</span>
                    </div>
                  )}
                  {rows.map(({ label, r, okText }) => (
                    <div key={label} className={`p-2.5 rounded-lg text-[11px] border ${r.ok ? 'bg-emerald-950/30 border-emerald-500/30 text-emerald-600' : 'bg-red-950/30 border-red-500/40 text-red-600'}`}>
                      <p className="font-semibold">{r.ok ? '✓' : '✗'} {label}</p>
                      <p className="text-slate-300 whitespace-pre-line">{r.ok ? okText(r) : r.error}</p>
                    </div>
                  ))}
                  {needAuth && (
                    <div className="p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/40 text-[11px] space-y-2">
                      <p className="text-viaim-textMain font-semibold flex items-center gap-1"><LogIn className="w-3.5 h-3.5" />授权录音笔记推送（只需一次）</p>
                      <p className="text-viaim-textMuted">办公本录音笔记接口需要单独的推送会话。请输入当前讯飞账号的密码，授权后会自动重新推送。密码仅用于本次登录，不会保存。</p>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={authPassword}
                          onChange={(e) => setAuthPassword(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAuthorizeRecordPush(); }}
                          placeholder="讯飞账号密码"
                          className="flex-1 px-2 py-1.5 rounded-lg bg-viaim-bg border border-viaim-border text-viaim-textMain text-xs outline-none focus:border-amber-500"
                        />
                        <button
                          onClick={handleAuthorizeRecordPush}
                          disabled={authBusy || !authPassword}
                          className="px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold disabled:opacity-50 cursor-pointer"
                        >
                          {authBusy ? '授权中…' : '授权并推送'}
                        </button>
                      </div>
                      {authError && <p className="text-red-600">{authError}</p>}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* 选项卡 3：AI 问答 */}
      {activeTab === 'chat' && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div ref={chatBodyRef} className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar select-text">
            {chatMessages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex gap-2.5 text-xs ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-cyan-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
                    <Bot className="w-3.5 h-3.5" />
                  </div>
                )}
                <div
                  className={`p-3 rounded-2xl max-w-[85%] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-viaim-primary text-white rounded-tr-none'
                      : 'bg-slate-900 border border-viaim-border text-slate-200 rounded-tl-none whitespace-pre-line'
                  }`}
                >
                  {msg.content}
                  <MemoryState projects={msg.projects || []} warnings={msg.memoryWarnings || []}
                    citations={msg.citations || []} onOpen={onOpenMemory} />
                  {!!msg.citations?.length && (
                    <div className="mt-3 pt-2 border-t border-viaim-border space-y-2 whitespace-normal">
                      <div className="text-[10px] text-cyan-300">依据的会议原文（检索片段，非全量结论）</div>
                      {msg.citations.map((citation) => (
                        <details key={citation.chunkId} className="text-[11px]">
                          <summary className="cursor-pointer text-cyan-200">
                            [{citation.ref}] {citation.title} · {citation.sourceType==='document' ? (citation.location || `来源页 ${citation.pages?.join('、')}`) : `${Math.floor(citation.startMs / 60000)}:${String(Math.floor(citation.startMs / 1000) % 60).padStart(2, '0')}`}
                          </summary>
                          <div className="text-viaim-textDim mt-1">{citation.occurredAt ? new Date(citation.occurredAt).toLocaleString('zh-CN') : '会议时间未知'} · 回答时的原文</div>
                          <p className="whitespace-pre-wrap mt-1 max-h-48 overflow-auto select-text">{citation.excerpt}</p>
                          <button className="mt-1 text-cyan-300 hover:text-white cursor-pointer" onClick={async () => {
                            try { await onOpenMemory(citation); }
                            catch (err: any) { setChatMessages((prev) => [...prev, { role: 'assistant', content: err?.message || '来源暂不可读取' }]); }
                          }}>打开来源</button>
                        </details>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isChatLoading && (
              <div className="flex gap-2.5 text-xs justify-start">
                <div className="w-6 h-6 rounded-full bg-cyan-600/30 border border-cyan-500/40 flex items-center justify-center text-cyan-300 shrink-0">
                  <Bot className="w-3.5 h-3.5" />
                </div>
                <div className="p-3 rounded-2xl rounded-tl-none bg-slate-900 border border-viaim-border text-slate-300 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" />
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0.15s' }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-bounce" style={{ animationDelay: '0.3s' }} />
                </div>
              </div>
            )}
          </div>

          <div className="p-3 border-t border-viaim-border bg-viaim-bg/80 shrink-0 space-y-2">
            <div className="text-[10px] text-viaim-textDim">{mentionedMeetings.length ? '范围：所选会议' : '范围：自动检索会议和文档'} · 后台记忆整理使用已配置的模型，可能产生用量</div>
            {/* 已 @ 的上下文录音（chips） */}
            {mentionedMeetings.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {mentionedMeetings.map((m) => (
                  <span
                    key={m.id}
                    className="max-w-full px-2 py-1 rounded-md bg-viaim-primary/15 border border-viaim-primary/40 text-[11px] text-indigo-300 flex items-center gap-1"
                  >
                    <AtSign className="w-3 h-3 shrink-0" />
                    <span className="line-clamp-1">{m.title}</span>
                    <button
                      onClick={() => removeMention(m.id)}
                      className="shrink-0 hover:text-white cursor-pointer"
                      title="移除该上下文"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* 相对定位容器：@ 候选下拉 */}
            <div className="relative">
              <div className="flex items-center gap-2">
                <input
                  ref={chatInputRef}
                  type="text"
                  placeholder="直接提问历史会议，@ 可限定范围…"
                  value={chatInput}
                  onChange={(e) => handleChatInputChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && mentionCandidates.length === 0) handleSendChat();
                    if (e.key === 'Escape') setMentionQuery(null);
                  }}
                  className="flex-1 bg-viaim-card border border-viaim-border rounded-xl px-3 py-2 text-xs text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-cyan-500 transition-colors"
                />
                <button
                  onClick={handleSendChat}
                  disabled={isChatLoading}
                  className="p-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-60 text-white transition-colors cursor-pointer"
                  title="发送问题"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>

              {mentionQuery !== null && (
                <div className="absolute bottom-full left-0 right-0 mb-2 bg-slate-900 border border-viaim-borderLight rounded-xl shadow-2xl overflow-hidden z-40">
                  <div className="px-3 py-1.5 text-[10px] text-viaim-textDim border-b border-viaim-border bg-viaim-bg/80">
                    选择要作为上下文的录音（可多次 @ 选多条）
                  </div>
                  {mentionCandidates.length === 0 ? (
                    <div className="px-3 py-2.5 text-[11px] text-viaim-textDim">没有匹配的录音</div>
                  ) : (
                    mentionCandidates.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => pickMention(m)}
                        className="w-full px-3 py-2 text-left text-xs text-slate-200 hover:bg-cyan-600/20 transition-colors cursor-pointer flex items-center gap-2"
                      >
                        <AtSign className="w-3 h-3 text-cyan-400 shrink-0" />
                        <span className="line-clamp-1">{m.title}</span>
                        <span className="ml-auto text-[10px] text-viaim-textDim shrink-0">{m.duration}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* 回答模型选择（来自设置中已配置的模型） */}
            <div className="flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-viaim-textDim shrink-0" />
              <span className="text-[11px] text-viaim-textDim shrink-0">回答模型</span>
              {modelOptions.length === 0 ? (
                <span className="text-[11px] text-amber-500">未检测到已配置的模型，请前往「设置 → 大模型LLM设置」配置</span>
              ) : (
                <select
                  value={selectedModelKey}
                  onChange={(e) => setSelectedModelKey(e.target.value)}
                  className="flex-1 bg-viaim-card border border-viaim-border rounded-lg px-2 py-1 text-[11px] text-viaim-textMain focus:outline-none focus:border-cyan-500 cursor-pointer"
                >
                  {modelOptions.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
