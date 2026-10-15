import React, { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Info, AlertTriangle, ShieldAlert, X, Power } from 'lucide-react';
import { ToastPayload, ToastSeverity, useToastSubscription } from '../hooks/useToast';

const DEFAULT_DURATION = 3500;

const SEVERITY_STYLE: Record<
  ToastSeverity,
  { border: string; iconBg: string; icon: React.ReactNode; badge: string; btn: string }
> = {
  success: {
    border: 'border-emerald-500/50',
    iconBg: 'bg-emerald-500/20',
    icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
    badge: 'bg-emerald-500/20 text-emerald-600 border-emerald-500/40',
    btn: 'text-emerald-600 hover:text-emerald-700'
  },
  info: {
    border: 'border-cyan-500/50',
    iconBg: 'bg-cyan-500/20',
    icon: <Info className="w-4 h-4 text-cyan-600" />,
    badge: 'bg-cyan-500/20 text-cyan-600 border-cyan-500/40',
    btn: 'text-cyan-600 hover:text-cyan-700'
  },
  warning: {
    border: 'border-amber-500/50',
    iconBg: 'bg-amber-500/20',
    icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
    badge: 'bg-amber-500/20 text-amber-600 border-amber-500/40',
    btn: 'text-amber-600 hover:text-amber-700'
  },
  error: {
    border: 'border-red-500/50',
    iconBg: 'bg-red-500/20',
    icon: <ShieldAlert className="w-4 h-4 text-red-600" />,
    badge: 'bg-red-500/20 text-red-600 border-red-500/40',
    btn: 'text-red-600 hover:text-red-600'
  },
  danger: {
    border: 'border-red-500/60',
    iconBg: 'bg-red-500/25',
    icon: <Power className="w-4 h-4 text-red-600" />,
    badge: 'bg-red-500/25 text-red-600 border-red-500/50',
    btn: 'text-red-600 hover:text-red-600'
  }
};

function ToastItem({ toast, onClose }: { toast: ToastPayload; onClose: (id: string) => void }) {
  const s = SEVERITY_STYLE[toast.severity];
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dur = toast.duration ?? DEFAULT_DURATION;
    if (dur <= 0) return;
    timerRef.current = setTimeout(() => onClose(toast.id), dur);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [toast.id, toast.duration, onClose]);

  return (
    <div
      role="status"
      aria-live={toast.severity === 'error' || toast.severity === 'danger' ? 'assertive' : 'polite'}
      className={`glass-panel border ${s.border} rounded-xl px-3.5 py-3 w-[360px] max-w-[92vw] flex items-start gap-3 shadow-2xl`}
    >
        <div className={`shrink-0 w-7 h-7 rounded-lg ${s.iconBg} flex items-center justify-center`}>
          {s.icon}
        </div>
        <div className="flex-1 min-w-0">
          {toast.title && (
            <div className={`inline-block text-[10px] px-1.5 py-0.5 rounded border ${s.badge} font-semibold mb-1`}>
              {toast.title}
            </div>
          )}
          <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line break-words">
            {toast.body}
          </p>
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.run();
                onClose(toast.id);
              }}
              className={`mt-1.5 text-[11px] font-semibold underline ${s.btn} transition-colors cursor-pointer`}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => onClose(toast.id)}
          className="shrink-0 text-viaim-textDim hover:text-viaim-textMain transition-colors cursor-pointer p-0.5"
          aria-label="关闭通知"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
  );
}

export const ToastViewport: React.FC = () => {
  const [items, setItems] = useState<ToastPayload[]>([]);

  useToastSubscription(setItems);

  const handleClose = (id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  };

  if (items.length === 0) return null;

  return (
    <div
      aria-label="通知面板"
      className="fixed bottom-6 right-6 z-50 flex flex-col gap-2.5 max-w-[calc(100vw-3rem)] pointer-events-none"
    >
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto">
          <ToastItem toast={t} onClose={handleClose} />
        </div>
      ))}
    </div>
  );
};