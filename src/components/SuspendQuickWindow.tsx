import React, { useEffect, useRef, useState } from 'react';
import {
  Mic,
  Pause,
  Play,
  Square,
  Bookmark,
  Sparkles,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const POS_KEY = 'viaim-quick-capsule-pos';
const BAR_COUNT = 12;

interface SuspendQuickWindowProps {
  isOpen: boolean;
  onClose: () => void;
  isRecording: boolean;
  isPaused: boolean;
  onStartRecord: () => void;
  onPauseResume: () => void;
  onStopRecording: () => void;
  onFinishAndSummarize: () => void;
  onAddBookmark: () => void;
  recordingDuration: string;
  latestSentence: string;
  analyser: AnalyserNode | null;
  autoSummarize: boolean;
}

function loadPos(): { x: number; y: number } {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return { x: 24, y: 72 };
    const parsed = JSON.parse(raw) as { x?: number; y?: number };
    if (Number.isFinite(parsed.x) && Number.isFinite(parsed.y)) {
      return { x: parsed.x!, y: parsed.y! };
    }
  } catch (_) { /* ignore */ }
  return { x: 24, y: 72 };
}

function clampPos(x: number, y: number, width: number, height: number) {
  const maxX = Math.max(8, window.innerWidth - width - 8);
  const maxY = Math.max(8, window.innerHeight - height - 8);
  return {
    x: Math.min(maxX, Math.max(8, x)),
    y: Math.min(maxY, Math.max(8, y)),
  };
}

export const SuspendQuickWindow: React.FC<SuspendQuickWindowProps> = ({
  isOpen,
  onClose,
  isRecording,
  isPaused,
  onStartRecord,
  onPauseResume,
  onStopRecording,
  onFinishAndSummarize,
  onAddBookmark,
  recordingDuration,
  latestSentence,
  analyser,
  autoSummarize,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState(loadPos);
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0.08));
  const rootRef = useRef<HTMLDivElement>(null);
  const posRef = useRef(pos);
  const dragRef = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const movedRef = useRef(false);
  posRef.current = pos;

  useEffect(() => {
    if (!isRecording) setExpanded(false);
  }, [isRecording]);

  useEffect(() => {
    if (!isOpen) return;
    const onResize = () => {
      const el = rootRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos((p) => clampPos(p.x, p.y, rect.width, rect.height));
    };
    onResize();
    const observer = new ResizeObserver(onResize);
    if (rootRef.current) observer.observe(rootRef.current);
    window.addEventListener('resize', onResize);
    return () => { observer.disconnect(); window.removeEventListener('resize', onResize); };
  }, [isOpen, expanded]);

  useEffect(() => {
    if (!isOpen || !isRecording || isPaused || !analyser) {
      setLevels(Array(BAR_COUNT).fill(0.08));
      return;
    }
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const tick = () => {
      analyser.getByteFrequencyData(data);
      const step = Math.max(1, Math.floor(data.length / BAR_COUNT));
      const next = Array.from({ length: BAR_COUNT }, (_, i) => {
        let sum = 0;
        for (let j = 0; j < step; j++) sum += data[i * step + j] || 0;
        return Math.max(0.08, Math.min(1, (sum / step) / 180));
      });
      setLevels(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isOpen, isRecording, isPaused, analyser]);

  if (!isOpen) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const el = rootRef.current;
    if (!el) return;
    movedRef.current = false;
    dragRef.current = { ox: e.clientX, oy: e.clientY, px: pos.x, py: pos.y };
    el.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.ox;
    const dy = e.clientY - dragRef.current.oy;
    if (Math.abs(dx) + Math.abs(dy) > 3) movedRef.current = true;
    const el = rootRef.current;
    const w = el?.offsetWidth || 280;
    const h = el?.offsetHeight || 48;
    setPos(clampPos(dragRef.current.px + dx, dragRef.current.py + dy, w, h));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      rootRef.current?.releasePointerCapture(e.pointerId);
    } catch (_) { /* ignore */ }
    if (movedRef.current) {
      try {
        localStorage.setItem(POS_KEY, JSON.stringify(posRef.current));
      } catch (_) { /* ignore */ }
    }
  };

  const primaryTitle = !isRecording
    ? '开始录音'
    : isPaused
      ? '继续录音'
      : '暂停录音';

  const onPrimary = () => {
    if (!isRecording) onStartRecord();
    else onPauseResume();
  };

  return (
    <div
      ref={rootRef}
      aria-label="快捷录音胶囊"
      role="region"
      className="fixed z-50 select-none"
      style={{ left: pos.x, top: pos.y }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <div
        className={`glass-floating rounded-full border border-viaim-primary/35 shadow-glow-primary bg-viaim-card/95 backdrop-blur-xl transition-[width,border-radius] duration-200 ${
          expanded ? 'rounded-2xl w-[340px]' : 'w-auto'
        }`}
      >
        <div className={`flex items-center gap-2 ${expanded ? 'px-3 pt-2.5 pb-1.5' : 'px-2 py-1.5'}`}>
          <button
            type="button"
            onClick={onPrimary}
            className={`relative w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-transform hover:scale-105 active:scale-95 cursor-pointer ${
              isRecording
                ? isPaused
                  ? 'bg-viaim-amber text-white shadow-md'
                  : 'bg-red-500 text-white shadow-glow-red'
                : 'bg-viaim-primary text-white shadow-glow-primary'
            }`}
            title={primaryTitle}
          >
            {isRecording && !isPaused && (
              <span className="absolute inset-0 rounded-full bg-red-500/35 animate-pulse-ring pointer-events-none" />
            )}
            {!isRecording ? (
              <Mic className="w-4 h-4" />
            ) : isPaused ? (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            ) : (
              <Pause className="w-4 h-4 fill-current" />
            )}
          </button>

          <div className="flex items-center gap-2 min-w-0">
            <span className="text-sm font-mono font-bold tracking-wider text-viaim-textMain tabular-nums">
              {recordingDuration || '00:00'}
            </span>
            {isRecording && (
              <span
                className={`text-[10px] font-semibold ${
                  isPaused ? 'text-viaim-amber' : 'text-red-500'
                }`}
              >
                {isPaused ? '暂停' : 'REC'}
              </span>
            )}
          </div>

          <div className="h-5 w-[72px] flex items-end justify-center gap-0.5 shrink-0">
            {levels.map((level, i) => (
              <div
                key={i}
                className={`w-[3px] rounded-full ${
                  isRecording && !isPaused
                    ? 'bg-gradient-to-t from-viaim-primary to-viaim-cyan'
                    : 'bg-viaim-border'
                }`}
                style={{ height: `${Math.round(level * 18)}px` }}
              />
            ))}
          </div>

          <div className="flex items-center gap-0.5 ml-auto shrink-0">
            {isRecording && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="p-1.5 rounded-full text-viaim-textMuted hover:text-viaim-textMain hover:bg-viaim-cardHover transition-colors cursor-pointer"
                title={expanded ? '收起' : '展开快捷操作'}
              >
                {expanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full text-viaim-textMuted hover:text-red-500 hover:bg-viaim-cardHover transition-colors cursor-pointer"
              title="收起胶囊（不停录）"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {expanded && isRecording && (
          <div className="px-3 pb-2.5 space-y-2 border-t border-viaim-border/70 pt-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onStopRecording}
                className="flex-1 h-8 px-2 rounded-lg bg-viaim-card border border-viaim-border text-xs text-viaim-textMain hover:bg-viaim-cardHover flex items-center justify-center gap-1 cursor-pointer"
                title="停止录音"
              >
                <Square className="w-3 h-3 fill-current" />
                停止
              </button>
              <button
                type="button"
                onClick={onAddBookmark}
                className="flex-1 h-8 px-2 rounded-lg bg-viaim-card border border-viaim-border text-xs text-viaim-amber hover:bg-viaim-cardHover flex items-center justify-center gap-1 cursor-pointer"
                title="在当前时刻标记重点"
              >
                <Bookmark className="w-3 h-3" />
                标记
              </button>
              <button
                type="button"
                onClick={onFinishAndSummarize}
                className="flex-1 h-8 px-2 rounded-lg bg-viaim-primary text-white text-xs font-medium hover:bg-viaim-primaryHover flex items-center justify-center gap-1 cursor-pointer shadow-sm"
                title={autoSummarize ? '停止录音并生成纪要' : '停止录音（自动提炼已关闭）'}
              >
                <Sparkles className="w-3 h-3" />
                {autoSummarize ? '停止并提炼' : '停止'}
              </button>
            </div>
            <p className="text-[11px] text-viaim-textMuted line-clamp-1 px-0.5">
              {latestSentence
                || (isPaused ? '已暂停' : '正在听写…')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
