import React, { useEffect, useState } from 'react';
import { Sparkles, RefreshCw, ListOrdered, CheckSquare, FileCheck } from 'lucide-react';
import { Meeting } from '../types';
import { api, MemoryCitation } from '../services/api';
import { AutomaticFollowup } from './AutomaticFollowup';

interface Props {
  meeting: Meeting;
  onGenerateAiSummary: (options?: { force?: boolean }) => void;
  isGeneratingAi: boolean;
  generationBusy: boolean;
  generationError: string;
  pendingTodoIds: Set<string>;
  onToggleTodo: (id: string) => void;
  onOpenMemory: (citation: MemoryCitation) => Promise<void>;
}

export function MeetingSummary({ meeting, onGenerateAiSummary, isGeneratingAi, generationBusy, generationError, pendingTodoIds, onToggleTodo, onOpenMemory }: Props) {
  const summary = meeting.aiSummary;
  const hasSummary = !!(summary && (summary.generated || summary.abstract || summary.summaryFull || summary.topics?.length || summary.todos?.length));
  const [relatedMemories, setRelatedMemories] = useState<MemoryCitation[]>([]);
  const [memoryError, setMemoryError] = useState('');
  useEffect(() => {
    let cancelled = false;
    setRelatedMemories([]);
    setMemoryError('');
    api.relatedMemories(meeting.id).then(items => { if (!cancelled) setRelatedMemories(items); })
      .catch(() => { if (!cancelled) setMemoryError('历史线索暂不可读取，请稍后重新打开纪要。'); });
    return () => { cancelled = true; };
  }, [meeting.id, summary?.summaryFull]);
  return (
        <div aria-label="会议纪要内容" className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar select-text">
          {generationError && <p role="alert" className="text-xs text-red-500">{generationError} · 请点击生成按钮重试</p>}
          {generationBusy && !isGeneratingAi && <p className="text-xs text-viaim-textDim">另一场会议正在生成纪要，请稍候。</p>}
          {meeting.source === 'viaim' && <p className="text-xs text-viaim-textDim">官方会议待办只读。</p>}
          {hasSummary ? (
            <>
              {summary.title && <h2 className="text-sm font-bold">{summary.title}</h2>}
              {/* 会议核心总结卡片 */}
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-indigo-950/40 to-slate-900 border border-indigo-500/30">
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-indigo-300 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-viaim-primary" />
                    会议核心总结
                  </span>
                  <button
                    onClick={() => onGenerateAiSummary({ force: true })}
                    disabled={generationBusy}
                    className="text-[11px] text-viaim-textDim hover:text-indigo-300 flex items-center gap-1 transition-colors cursor-pointer"
                    title="重新调用大模型提炼（忽略已有结果）"
                  >
                    <RefreshCw className={`w-3 h-3 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                    <span>{isGeneratingAi ? '正在生成…' : '重新生成纪要'}</span>
                  </button>
                </div>
                <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-line">
                  {summary.abstract || (summary.summaryFull ? summary.summaryFull.substring(0, 200) + '...' : '')}
                </p>
              </div>


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
                      <label
                        key={todo.id}

                        className={`flex items-start gap-2.5 p-2 rounded-lg border transition-all cursor-pointer ${
                          todo.done
                            ? 'bg-emerald-950/20 border-emerald-500/30 text-viaim-textDim line-through'
                            : 'bg-slate-900/60 border-viaim-border hover:border-slate-600 text-slate-200'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={todo.done}
                          onChange={() => onToggleTodo(todo.id)}
                          aria-label={todo.task}
                          disabled={meeting.source === 'viaim' || pendingTodoIds.has(todo.id)}
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
                      </label>
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
                disabled={generationBusy}
                className="px-4 py-2 rounded-xl bg-gradient-to-r from-viaim-primary to-indigo-600 hover:from-indigo-500 hover:to-indigo-600 text-white text-xs font-bold flex items-center gap-2 shadow-glow-primary transition-all cursor-pointer"
              >
                <Sparkles className={`w-4 h-4 ${isGeneratingAi ? 'animate-spin' : ''}`} />
                <span>{isGeneratingAi ? '正在生成…' : '生成会议纪要'}</span>
              </button>
            </div>
          )}
          <details className="rounded-xl border border-viaim-border p-3 text-xs">
            <summary className="cursor-pointer font-semibold text-cyan-300">相关记忆与历史跟进</summary>
            <p className="text-viaim-textDim my-2">历史线索用于核对背景，不属于本次决议；完成证据不等于手动确认完成。</p>
            <AutomaticFollowup meetingId={meeting.id} onOpen={onOpenMemory} />
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
                </div>
              )}

            {!relatedMemories.length && <p className="text-viaim-textDim mt-2">暂无关联历史线索。</p>}
            {memoryError && <p role="alert" className="text-amber-500 mt-2">{memoryError}</p>}
          </details>
        </div>
  );
}
