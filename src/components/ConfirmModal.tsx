import React from 'react';
import { AlertTriangle, X, ShieldAlert, Trash2, Share2, RotateCcw, LogOut, Power } from 'lucide-react';

export type ConfirmVariant = 'danger' | 'warning' | 'info';

export interface ConfirmAction {
  /** 操作标题 */
  title: string;
  /** 影响范围描述 */
  scope: string;
  /** 操作对象（笔记标题/ID） */
  target: string;
  /** 操作后果 */
  consequence: string;
  /** 二次输入的"确认字"（如 YSE/DEL/PUSH），大写 */
  typeToConfirm?: string;
  /** 变体：danger=红色高危, warning=橙色警告, info=蓝色提示 */
  variant?: ConfirmVariant;
  /** 主按钮文字 */
  confirmText?: string;
}

interface ConfirmModalProps {
  isOpen: boolean;
  action: ConfirmAction | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  isOpen,
  action,
  onCancel,
  onConfirm
}) => {
  const [typed, setTyped] = React.useState('');

  React.useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen, action]);

  if (!isOpen || !action) return null;

  const variant = action.variant || 'warning';
  const needType = !!action.typeToConfirm;
  const canConfirm = !needType || typed === action.typeToConfirm;

  const styleMap = {
    danger: {
      border: 'border-red-500/50',
      bg: 'bg-red-500/8',
      icon: <Trash2 className="w-5 h-5 text-red-600" />,
      iconBg: 'bg-red-500/20',
      btn: 'bg-gradient-to-r from-red-500 to-red-600 hover:from-red-400 hover:to-red-500 text-white shadow-red-500/30',
      badge: 'bg-red-500/20 text-red-600 border-red-500/40'
    },
    warning: {
      border: 'border-amber-500/50',
      bg: 'bg-amber-500/8',
      icon: <ShieldAlert className="w-5 h-5 text-amber-600" />,
      iconBg: 'bg-amber-500/20',
      btn: 'bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white shadow-amber-500/30',
      badge: 'bg-amber-500/20 text-amber-600 border-amber-500/40'
    },
    info: {
      border: 'border-cyan-500/50',
      bg: 'bg-cyan-500/8',
      icon: <Share2 className="w-5 h-5 text-cyan-300" />,
      iconBg: 'bg-cyan-500/20',
      btn: 'bg-gradient-to-r from-cyan-500 to-cyan-600 hover:from-cyan-400 hover:to-cyan-500 text-white shadow-cyan-500/30',
      badge: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
    }
  };
  const s = styleMap[variant];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div className={`bg-viaim-card border ${s.border} w-[480px] max-w-[92vw] rounded-2xl shadow-2xl overflow-hidden select-none`}>
        <div className={`flex items-center justify-between p-4 border-b border-viaim-border ${s.bg}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-xl ${s.iconBg} flex items-center justify-center`}>
              {s.icon}
            </div>
            <div>
              <h2 className="text-sm font-bold text-viaim-textMain">{action.title}</h2>
              <span className={`inline-block text-[10px] mt-0.5 px-1.5 py-0.5 rounded border ${s.badge} font-semibold`}>
                需要二次确认 · 影响云端数据
              </span>
            </div>
          </div>
          <button onClick={onCancel} className="p-1.5 rounded-lg hover:bg-slate-800 text-viaim-textMuted hover:text-viaim-textMain">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-3 text-xs">
          <div className="flex items-start gap-2">
            <span className="text-viaim-textDim shrink-0 mt-0.5">操作对象</span>
            <span className="text-viaim-textMain font-mono break-all">{action.target}</span>
          </div>
          <div className="flex items-start gap-2">
            <span className="text-viaim-textDim shrink-0 mt-0.5">影响范围</span>
            <span className="text-slate-200">{action.scope}</span>
          </div>
          <div className="p-2.5 rounded-lg bg-slate-900/70 border border-viaim-border/60 flex items-start gap-2">
            <AlertTriangle className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${
              variant === 'danger' ? 'text-red-600' : variant === 'warning' ? 'text-amber-600' : 'text-cyan-400'
            }`} />
            <span className="text-slate-200 leading-relaxed">{action.consequence}</span>
          </div>

          {needType && (
            <div>
              <label className="block text-[11px] text-viaim-textMuted mb-1.5">
                为了避免误操作，请输入
                <span className={`mx-1.5 px-2 py-0.5 rounded font-mono font-bold ${s.badge} border`}>{action.typeToConfirm}</span>
                以确认
              </label>
              <input
                type="text"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={action.typeToConfirm}
                className="w-full bg-slate-950 border border-viaim-border rounded-lg px-3 py-2 text-xs text-viaim-textMain font-mono focus:outline-none focus:border-amber-400"
                autoFocus
              />
            </div>
          )}
        </div>

        <div className="p-4 border-t border-viaim-border flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors cursor-pointer"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            disabled={!canConfirm}
            className={`px-4 py-2 rounded-lg ${s.btn} text-xs font-bold shadow-md transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed`}
          >
            {action.confirmText || '确认执行'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** 预设操作构造器 */
export const ConfirmActions = {
  recycleNote: (title: string, noteId: string): ConfirmAction => ({
    title: '移入云端回收站',
    scope: '讯飞云端 + 本地列表',
    target: `${title} (${noteId.substring(0, 12)}...)`,
    consequence: '该笔记将从云端列表移除，并进入 30 天可恢复的回收站。本地 UI 不再展示。云端其他设备同步隐藏。',
    typeToConfirm: 'RECYCLE',
    variant: 'warning',
    confirmText: '移入回收站'
  }),
  deleteFromCloud: (title: string, noteId: string): ConfirmAction => ({
    title: '从讯飞云端彻底删除',
    scope: '讯飞云端（不可恢复）',
    target: `${title} (${noteId.substring(0, 12)}...)`,
    consequence: '⚠️ 该笔记将从讯飞云端永久擦除，包括所有转写、录音、附件。30 天后无法恢复。',
    typeToConfirm: 'DELETE',
    variant: 'danger',
    confirmText: '永久删除'
  }),
  shareNote: (title: string, noteId: string): ConfirmAction => ({
    title: '生成云端分享链接',
    scope: '讯飞云端（7 天有效）',
    target: `${title} (${noteId.substring(0, 12)}...)`,
    consequence: '系统将在讯飞云端创建一条分享记录，生成可对外公开的访问链接。任何持有链接的人可在 7 天内阅读笔记内容。',
    variant: 'info',
    confirmText: '生成分享链接'
  }),
  toggleCloudThing: (title: string): ConfirmAction => ({
    title: '切换讯飞办公本待办',
    scope: '讯飞办公本云端',
    target: title,
    consequence: '此操作会同步到绑定办公本的待办列表。其他设备/客户端将立即看到状态变化。',
    variant: 'info',
    confirmText: '确认切换'
  })
};