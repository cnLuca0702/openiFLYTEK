import React, { useState } from 'react';
import {
  Tablet,
  FileCheck,
  Bot,
  ArrowRight,
  Wifi,
  AlertCircle,
  LogIn,
} from 'lucide-react';
import { QaPanel } from './QaPanel';
import { QaSource } from '../services/qa';
import { Meeting, OfficeNotebookDevice } from '../types';
import { api, MemoryCitation } from '../services/api';

interface AiSummaryPanelProps {
  meeting: Meeting | null;
  currentSource: QaSource | null;
  onOpenQaSettings: () => void;
  onOpenMemory: (citation: MemoryCitation) => Promise<void>;
  onPushToNotebook: () => void;
  isPushing: boolean;
  isPushed: boolean;
  pushedResult: any;
  notebookDevice: OfficeNotebookDevice | null;
}

export const AiSummaryPanel: React.FC<AiSummaryPanelProps> = ({
  meeting,
  currentSource, onOpenQaSettings,
  onOpenMemory,
  onPushToNotebook,
  isPushing,
  isPushed,
  pushedResult,
  notebookDevice,
}) => {
  const [activeTab, setActiveTab] = useState<'notebook' | 'chat'>('chat');
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
  return (
    <aside className="w-full h-full border-l border-viaim-border bg-viaim-card/70 backdrop-blur-md flex flex-col shrink-0 select-none">
      {/* 选项卡头部 */}
      <div className="flex items-center border-b border-viaim-border p-1 bg-viaim-bg/60 text-xs shrink-0">
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

      <div className={activeTab === 'chat' ? 'flex flex-1 min-h-0 flex-col' : 'hidden'}><QaPanel currentSource={currentSource} onOpenMemory={onOpenMemory} onOpenSettings={onOpenQaSettings} /></div>

    </aside>
  );
};
