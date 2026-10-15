import React, { useState, useEffect } from 'react';
import { 
  Mic, 
  Volume2, 
  Square, 
  Bookmark, 
  Sparkles, 
  X, 
  Move, 
  Radio, 
  Maximize2 
} from 'lucide-react';

interface SuspendQuickWindowProps {
  isOpen: boolean;
  onClose: () => void;
  isRecording: boolean;
  onToggleRecord: () => void;
  recordingDuration: string;
  latestSentence: string;
  onAddBookmark: () => void;
  onFinishAndSummarize: () => void;
  onRestoreMainWindow: () => void;
}

export const SuspendQuickWindow: React.FC<SuspendQuickWindowProps> = ({
  isOpen,
  onClose,
  isRecording,
  onToggleRecord,
  recordingDuration,
  latestSentence,
  onAddBookmark,
  onFinishAndSummarize,
  onRestoreMainWindow
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed top-6 right-8 z-50 animate-in fade-in zoom-in-95 duration-200">
      <div className="glass-floating rounded-2xl p-3 w-[460px] border border-indigo-500/40 shadow-2xl backdrop-blur-2xl bg-slate-950/90 select-none">
        {/* 顶部控制把手与标题 */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-viaim-border/60 text-xs text-viaim-textMuted">
          <div className="flex items-center gap-2">
            <Move className="w-3.5 h-3.5 text-viaim-primary cursor-move" />
            <span className="font-semibold text-viaim-textMain tracking-wide flex items-center gap-1.5">
              <span>OpeniFLYTEK 快捷录音条</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-normal">
                悬浮模式
              </span>
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button 
              onClick={onRestoreMainWindow}
              className="p-1 hover:text-viaim-textMain hover:bg-slate-800 rounded transition-colors"
              title="切换为主界面视图"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button 
              onClick={onClose}
              className="p-1 hover:text-red-600 hover:bg-slate-800 rounded transition-colors"
              title="关闭悬浮条"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* 录制状态与音频参数 */}
        <div className="flex items-center justify-between gap-3 mb-2.5">
          {/* 录音主开关与时长 */}
          <div className="flex items-center gap-3">
            <button
              onClick={onToggleRecord}
              className={`relative w-10 h-10 rounded-full flex items-center justify-center transition-transform hover:scale-105 active:scale-95 shadow-md cursor-pointer ${
                isRecording 
                  ? 'bg-red-500 text-white shadow-glow-red' 
                  : 'bg-viaim-primary text-white shadow-glow-primary'
              }`}
            >
              {isRecording ? (
                <>
                  <span className="absolute inset-0 rounded-full bg-red-500/40 animate-pulse-ring"></span>
                  <Square className="w-4 h-4 fill-current" />
                </>
              ) : (
                <Radio className="w-5 h-5" />
              )}
            </button>

            <div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-mono font-bold tracking-wider text-viaim-textMain">
                  {recordingDuration || '00:00'}
                </span>
                {isRecording && (
                  <span className="flex items-center gap-1 text-[11px] font-medium text-red-600">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-ping"></span>
                    REC
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-viaim-textMuted">
                <span className="flex items-center gap-0.5 text-viaim-cyan">
                  <Mic className="w-3 h-3" /> 本地麦克风
                </span>
                <span>+</span>
                <span className="flex items-center gap-0.5 text-indigo-300">
                  <Volume2 className="w-3 h-3" /> 系统会议声音 (AEC)
                </span>
              </div>
            </div>
          </div>

          {/* 快捷动作 */}
          <div className="flex items-center gap-1.5">
            <button
              onClick={onAddBookmark}
              disabled={!isRecording}
              className="px-2.5 py-1.5 rounded-lg bg-viaim-card hover:bg-slate-800 border border-viaim-border text-xs text-amber-600 flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="在转写中打上时间戳重点标记"
            >
              <Bookmark className="w-3.5 h-3.5" />
              <span>标记重点</span>
            </button>

            <button
              onClick={onFinishAndSummarize}
              disabled={!isRecording}
              className="px-3 py-1.5 rounded-lg bg-gradient-to-r from-viaim-primary to-indigo-600 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-medium flex items-center gap-1 shadow-md transition-all disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
              title="停止录音并立即生成 AI 纪要"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>生成纪要</span>
            </button>
          </div>
        </div>

        {/* 动态声音波形条 */}
        <div className="h-4 bg-slate-900/80 rounded-md border border-viaim-border/50 flex items-center justify-center gap-1 px-3 overflow-hidden">
          {Array.from({ length: 28 }).map((_, i) => (
            <div
              key={i}
              className={`w-1 rounded-full transition-all duration-150 ${
                isRecording 
                  ? 'bg-gradient-to-t from-viaim-primary to-viaim-cyan' 
                  : 'bg-slate-700/60 h-1'
              }`}
              style={{
                height: isRecording 
                  ? `${Math.max(3, Math.sin((i + Date.now() / 150) * 0.4) * 12 + 6)}px`
                  : '3px'
              }}
            />
          ))}
        </div>

        {/* 实时转写内容微预览 */}
        <div className="mt-2 pt-2 border-t border-viaim-border/50 flex items-start gap-2 text-xs">
          <span className="px-1.5 py-0.5 rounded bg-viaim-primary/20 text-indigo-300 text-[10px] font-semibold shrink-0">
            实时听写
          </span>
          <p className="text-viaim-textMuted line-clamp-1 italic">
            {latestSentence || (isRecording ? '正在监听双向语音...' : '录音未启动')}
          </p>
        </div>
      </div>
    </div>
  );
};
