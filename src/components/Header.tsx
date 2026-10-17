import React from 'react';
import { Mic, User } from 'lucide-react';
import { DevicesStatusResponse } from '../types';
import appIcon from '../assets/app-icon.png';

interface HeaderProps {
  deviceStatus: DevicesStatusResponse | null;
  onOpenMemory: () => void;
  isQuickBarOpen: boolean;
  onToggleQuickBar: () => void;
  isRecording: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  deviceStatus,
  onOpenMemory,
  isQuickBarOpen,
  onToggleQuickBar,
  isRecording,
}) => {
  const user = deviceStatus?.user;

  return (
    <header
      className="h-14 pl-20 pr-5 border-b border-viaim-border bg-viaim-card/95 backdrop-blur-md flex items-center gap-4 shrink-0 z-30 select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* 左侧弹性空区：整体留白（为 macOS 红绿灯按钮预留） */}
      <div className="flex-1 min-w-0" />

      <button
        type="button"
        onClick={onToggleQuickBar}
        className={`text-sm px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
          isQuickBarOpen
            ? 'bg-viaim-primary/15 border-viaim-primary/40 text-viaim-primary'
            : isRecording
              ? 'bg-red-500/10 border-red-500/40 text-red-500'
              : 'bg-viaim-card border-viaim-border text-viaim-textMuted hover:text-viaim-textMain hover:bg-viaim-cardHover'
        }`}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        title={isQuickBarOpen ? '收起快捷录音胶囊' : '打开快捷录音胶囊'}
      >
        <Mic className={`w-3.5 h-3.5 ${isRecording && !isQuickBarOpen ? 'animate-pulse' : ''}`} />
        <span>快捷录音</span>
      </button>
      <button onClick={onOpenMemory} className="text-sm text-cyan-300 px-3 py-1.5 rounded bg-slate-800" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>记忆与资料</button>
      {/* 用户（右对齐） */}
      <div
        className="flex items-center gap-2 shrink-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="flex items-center gap-2">
          {user?.avatar ? (
            <img
              src={user.avatar}
              alt={user.userName}
              className="w-7 h-7 rounded-full ring-1 ring-viaim-border object-cover"
              onError={(e) => {
                (e.target as HTMLElement).style.display = 'none';
              }}
            />
          ) : (
            <div className="w-7 h-7 rounded-full bg-viaim-bg border border-viaim-border flex items-center justify-center text-viaim-textMuted">
              {user?.userName ? (
                <span className="text-xs font-bold">{user.userName.substring(0, 1)}</span>
              ) : (
                <User className="w-3.5 h-3.5" />
              )}
            </div>
          )}
          <span className="hidden xl:block text-xs font-medium text-viaim-textMain">
            {user?.userName || '已登录'}
          </span>
        </div>
      </div>

      {/* 品牌标识（最右侧） */}
      <div
        className="flex items-center gap-2.5 shrink-0 pl-2 ml-1 border-l border-viaim-border"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <div className="leading-tight text-right">
          <div className="flex items-center gap-1.5 justify-end">
            <span className="font-bold text-[15px] tracking-wide text-viaim-textMain">OpeniFLYTEK</span>
            <span className="text-[10px] px-1.5 py-px rounded bg-viaim-bg border border-viaim-borderLight text-viaim-textDim font-medium">
              Mac Studio
            </span>
          </div>
          <p className="text-[10px] text-viaim-textDim">智能会议助手 & 办公本工作台</p>
        </div>
        <img src={appIcon} alt="OpeniFLYTEK" className="w-8 h-8 rounded-lg ring-1 ring-viaim-border object-cover" draggable={false} />
      </div>
    </header>
  );
};
