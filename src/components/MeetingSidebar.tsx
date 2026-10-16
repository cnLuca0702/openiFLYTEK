import React, { useState } from 'react';
import {
  Search,
  Clock,
  Users,
  Tablet,
  CheckCircle2,
  FileText,
  Calendar,
  MessageSquare,
  Trash2,
  Headphones,
  Wifi,
  AlertCircle,
  Settings,
  Plus,
  Radio,
  NotebookPen,
  Brain
} from 'lucide-react';
import { Meeting, DevicesStatusResponse } from '../types';
import { MemoryCitation } from '../services/api';
import { MemorySidebar } from './MemorySidebar';
import { useConfirm } from '../hooks/useConfirm';

interface MeetingSidebarProps {
  sidebarTab:'recordings'|'memory';
  onTabChange:(tab:'recordings'|'memory')=>void;
  selectedDocumentId:string|null;
  onShowPanorama:()=>void;
  meetings: Meeting[];
  selectedMeetingId: string | null;
  onSelectMeeting: (id: string) => void;
  pushedMeetingIds: Set<string>;
  onDeleteMeeting: (id: string) => void;
  onPushToNotebook: (meetingId: string) => void;
  isPushing: boolean;
  deviceStatus: DevicesStatusResponse | null;
  onOpenNotebookHub: () => void;
  onOpenSettings: () => void;
  isRecording: boolean;
  onToggleRecord: () => void;
  onOpenDocument: (docId: string) => void;
  onOpenMemory: (citation: MemoryCitation) => Promise<void>;
}

export const MeetingSidebar: React.FC<MeetingSidebarProps> = ({
  sidebarTab, onTabChange, selectedDocumentId, onShowPanorama,
  meetings,
  selectedMeetingId,
  onSelectMeeting,
  pushedMeetingIds,
  onDeleteMeeting,
  onPushToNotebook,
  isPushing,
  deviceStatus,
  onOpenNotebookHub,
  onOpenSettings,
  isRecording,
  onToggleRecord,
  onOpenDocument,
  onOpenMemory
}) => {
  const headset = deviceStatus?.viaimHeadset;
  const notebook = deviceStatus?.officeNotebook;
  const [searchTerm, setSearchTerm] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'todos' | 'synced'>('all');
  const confirm = useConfirm();

  const filteredMeetings = meetings.filter(m => {
    const matchesSearch = m.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (m.subtitle && m.subtitle.toLowerCase().includes(searchTerm.toLowerCase())) ||
      m.category.toLowerCase().includes(searchTerm.toLowerCase());
    
    if (!matchesSearch) return false;
    if (activeFilter === 'todos') {
      return (m.todoCount || 0) > 0 || (m.aiSummary?.todos?.length || 0) > 0;
    }
    if (activeFilter === 'synced') {
      return pushedMeetingIds.has(m.id);
    }
    return true;
  });

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      const m = (d.getMonth() + 1).toString().padStart(2, '0');
      const day = d.getDate().toString().padStart(2, '0');
      return `${m}-${day}`;
    } catch (_) {
      return '';
    }
  };

  return (
    <aside className="w-80 h-full border-r border-viaim-border bg-viaim-card/80 backdrop-blur-md flex flex-col shrink-0 select-none">
      {/* 侧栏双标签：录音与笔记 / 记忆与资料 */}
      <div className="shrink-0 flex gap-1 p-1.5 border-b border-viaim-border bg-viaim-bg/40 text-xs">
        <button
          onClick={() => onTabChange('recordings')}
          className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            sidebarTab === 'recordings'
              ? 'bg-viaim-primary/20 text-indigo-300 border border-viaim-primary/40'
              : 'text-viaim-textDim hover:text-viaim-textMain border border-transparent'
          }`}
        >
          <Radio className="w-3.5 h-3.5" />
          <span>录音与笔记</span>
        </button>
        <button
          onClick={() => onTabChange('memory')}
          className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
            sidebarTab === 'memory'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-viaim-textDim hover:text-viaim-textMain border border-transparent'
          }`}
        >
          <Brain className="w-3.5 h-3.5" />
          <span>记忆与资料</span>
        </button>
      </div>

      {sidebarTab === 'recordings' ? (
        <>
      {/* 顶部：新建会议录制（主操作） + 搜索与分类导航 */}
      <div className="p-3.5 border-b border-viaim-border">
        {/* 主操作：会议录制 */}
        <button
          onClick={onToggleRecord}
          className={`w-full h-9 mb-2.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            isRecording
              ? 'bg-red-500/10 border border-red-500/40 text-red-600 hover:bg-red-500/20'
              : 'bg-viaim-primary hover:bg-viaim-primaryHover text-white shadow-glow-primary border border-transparent'
          }`}
        >
          {isRecording ? (
            <>
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              <span>结束录制</span>
            </>
          ) : (
            <>
              <Plus className="w-3.5 h-3.5" />
              <span>新建会议录制</span>
            </>
          )}
        </button>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-viaim-textDim" />
          <input
            type="text"
            placeholder="搜索真实会议主题、实录内容..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-viaim-bg border border-viaim-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-viaim-primary transition-colors"
          />
        </div>

        {/* 筛选选项卡 */}
        <div className="flex items-center gap-1 mt-2.5 text-xs">
          <button
            onClick={() => setActiveFilter('all')}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeFilter === 'all'
                ? 'bg-viaim-primary/20 text-indigo-300 font-semibold'
                : 'text-viaim-textDim hover:text-viaim-textMain'
            }`}
          >
            全部 ({meetings.length})
          </button>
          <button
            onClick={() => setActiveFilter('todos')}
            className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
              activeFilter === 'todos'
                ? 'bg-viaim-primary/20 text-indigo-300 font-semibold'
                : 'text-viaim-textDim hover:text-viaim-textMain'
            }`}
          >
            含待办
          </button>
          <button
            onClick={() => setActiveFilter('synced')}
            className={`px-2.5 py-1 rounded-md flex items-center gap-1 transition-colors cursor-pointer ${
              activeFilter === 'synced'
                ? 'bg-amber-500/20 text-amber-600 font-semibold'
                : 'text-viaim-textDim hover:text-viaim-textMain'
            }`}
          >
            <Tablet className="w-3 h-3 text-amber-600" />
            <span>办公本已同步</span>
          </button>
        </div>
      </div>

      {/* 会议卡片列表（加载 kitdb.db 真实录音与句子） */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 custom-scrollbar">
        {filteredMeetings.length === 0 ? (
          <div className="h-48 flex flex-col items-center justify-center text-viaim-textDim text-xs">
            <FileText className="w-8 h-8 stroke-1 mb-2 opacity-50" />
            <p>暂无符合条件的会议记录</p>
          </div>
        ) : (
          filteredMeetings.map((m) => {
            const isSelected = m.id === selectedMeetingId;
            const isSynced = pushedMeetingIds.has(m.id);
            const isExternalViaim = m.source === 'viaim';
            const todoCount = m.todoCount || m.aiSummary?.todos?.length || 0;
            const sentenceCount = m.sentenceCount || m.sentences?.length || 0;

            return (
              <div
                key={m.id}
                onClick={() => onSelectMeeting(m.id)}
                className={`p-3 rounded-xl border transition-all cursor-pointer relative ${
                  isSelected
                    ? 'bg-viaim-cardHover border-viaim-primary/70 shadow-lg shadow-indigo-500/10'
                    : 'bg-viaim-card/40 border-viaim-border/60 hover:bg-viaim-card hover:border-viaim-border'
                }`}
              >
                {/* 选中高亮指示条 */}
                {isSelected && (
                  <div className="absolute left-0 top-3 bottom-3 w-1 bg-gradient-to-b from-viaim-primary to-viaim-cyan rounded-r-full" />
                )}

                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <h3 className="text-xs font-semibold line-clamp-1 leading-snug text-viaim-textMain">
                    {m.title}
                  </h3>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-viaim-textDim font-medium">
                      {formatDate(m.createdAt)}
                    </span>
                    {/* 推送到讯飞办公本（小图标，悬停显示功能提示） */}
                    <div className="relative group/push flex items-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (!isPushing) onPushToNotebook(m.id);
                        }}
                        disabled={isPushing}
                        className={`p-1 rounded transition-colors ${
                          isPushing
                            ? 'text-viaim-textDim opacity-50 cursor-not-allowed'
                            : isSynced
                              ? 'text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/15 cursor-pointer'
                              : 'text-slate-500 hover:text-amber-600 hover:bg-amber-500/15 cursor-pointer'
                        }`}
                      >
                        <NotebookPen className="w-3 h-3" />
                      </button>
                      <span className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-1.5 z-30 whitespace-nowrap rounded-md bg-slate-900 border border-viaim-border px-2 py-1 text-[10px] font-medium text-viaim-textMain shadow-lg opacity-0 group-hover/push:opacity-100 transition-opacity">
                        {isSynced ? '已推送办公本 · 点击可重新推送' : '推送到讯飞办公本'}
                      </span>
                    </div>
                    <div className="relative group/del flex items-center">
                      <button
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (isExternalViaim) return;
                          const ok = await confirm({
                            title: '删除会议',
                            scope: 'OpeniFLYTEK 项目自有存储',
                            target: m.title,
                            consequence: '该项目会议将从列表中隐藏。云端办公本和 VIAIM 官方数据库不受影响。',
                            typeToConfirm: 'DELETE',
                            variant: 'danger',
                            confirmText: '删除项目会议'
                          });
                          if (ok) onDeleteMeeting(m.id);
                        }}
                        disabled={isExternalViaim}
                        className={`p-1 rounded transition-colors ${isExternalViaim ? 'text-viaim-textDim cursor-not-allowed' : 'text-slate-500 hover:text-red-600 hover:bg-red-500/15 cursor-pointer'}`}
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      <span className="pointer-events-none absolute right-full top-1/2 -translate-y-1/2 mr-1.5 z-30 whitespace-nowrap rounded-md bg-slate-900 border border-viaim-border px-2 py-1 text-[10px] font-medium text-viaim-textMain shadow-lg opacity-0 group-hover/del:opacity-100 transition-opacity">
                        {isExternalViaim ? '官方录音仅可读，不可删除' : '删除会议（仅本项目存储）'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[11px] text-viaim-textDim">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3 text-slate-400" />
                      {m.duration}
                    </span>
                    {sentenceCount > 0 && (
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3 h-3 text-slate-400" />
                        {sentenceCount} 句
                      </span>
                    )}
                  </div>

                  {/* 状态徽章 */}
                  <div className="flex items-center gap-1.5">
                    {isSynced && (
                      <span className="flex items-center gap-0.5 text-[10px] text-amber-600 px-1 py-0.2 rounded bg-amber-500/10 border border-amber-500/20" title="已推送到讯飞智能办公本">
                        <Tablet className="w-3 h-3 text-amber-600" />
                        <span>已同步</span>
                      </span>
                    )}
                    {todoCount > 0 && (
                      <span className="flex items-center gap-0.5 text-[10px] text-indigo-300 px-1 py-0.2 rounded bg-indigo-500/10 font-semibold" title="包含待办事项">
                        <CheckCircle2 className="w-3 h-3 text-indigo-400" />
                        <span>{todoCount}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 底部：设备状态与设置入口（单行三按钮） */}
      <div className="shrink-0 border-t border-viaim-border p-3 flex items-stretch gap-1.5">
        {/* VIAIM 耳机：图标 + 双耳电量（名称悬停可见） */}
        <div
          className="flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-viaim-borderLight bg-viaim-bg text-[10px] tabular-nums text-viaim-textDim"
          title={`${headset?.name || 'VIAIM iFLYBUDS Pro'} · WebRTC AEC3 回声消除生效中 · 电量 L:${headset?.batteryLeft ?? 92}% R:${headset?.batteryRight ?? 88}%`}
        >
          <span className="relative flex items-center shrink-0">
            <Headphones className="w-3.5 h-3.5 text-viaim-textMuted" />
            <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-emerald-500 ring-2 ring-viaim-bg" />
          </span>
          <span>L:{headset?.batteryLeft ?? 92}%</span>
          <span className="text-viaim-textDim/60">/</span>
          <span>R:{headset?.batteryRight ?? 88}%</span>
        </div>

        {/* 讯飞智能办公本：图标 + 在线状态（点击进入互联工作台） */}
        <button
          onClick={onOpenNotebookHub}
          className="flex-1 min-w-0 flex items-center justify-center gap-1.5 h-9 rounded-lg border border-viaim-borderLight bg-viaim-bg hover:bg-viaim-cardHover hover:border-viaim-border text-[10px] transition-colors cursor-pointer"
          title={
            notebook?.authenticated && !notebook?.sessionValid
              ? `讯飞账号会话已失效：${notebook?.sessionReason || '请重新登录'} · 点击进入办公本中心重新登录`
              : `${notebook?.deviceName || '科大讯飞智能办公本'} · 点击查看办公本云端笔记库与设备管理`
          }
        >
          <span className="relative flex items-center shrink-0">
            <Tablet className="w-3.5 h-3.5 text-viaim-textMuted" />
            <span
              className={`absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full ring-2 ring-viaim-bg ${
                notebook?.connected ? 'bg-emerald-500' : notebook?.authenticated ? 'bg-red-500' : 'bg-amber-500'
              }`}
            />
          </span>
          {notebook?.connected ? (
            <span className="flex items-center gap-0.5 text-emerald-600 font-medium">
              <Wifi className="w-3 h-3" /> 在线
            </span>
          ) : notebook?.authenticated ? (
            <span className="flex items-center gap-0.5 text-red-500 font-medium">
              <AlertCircle className="w-3 h-3" /> 需重新登录
            </span>
          ) : (
            <span className="flex items-center gap-0.5 text-amber-600 font-medium">
              <AlertCircle className="w-3 h-3" /> 待配置
            </span>
          )}
        </button>

        {/* 设置 */}
        <button
          onClick={onOpenSettings}
          className="w-9 h-9 shrink-0 flex items-center justify-center rounded-lg border border-viaim-borderLight bg-viaim-bg hover:bg-viaim-cardHover hover:border-viaim-border text-viaim-textMuted hover:text-viaim-textMain transition-colors cursor-pointer"
          title="通用与硬件、大模型LLM、语音转写 ASR 设置"
        >
          <Settings className="w-4 h-4" />
        </button>
      </div>
        </>
      ) : (
        <MemorySidebar selectedDocumentId={selectedDocumentId} onShowPanorama={onShowPanorama} onOpenDocument={onOpenDocument} onOpenMemory={onOpenMemory} />
      )}
    </aside>
  );
};
