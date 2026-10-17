import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Upload,
  RotateCcw,
  Download,
  Trash2,
  RefreshCw,
  Brain,
  FileSearch,
  FileText,
  FileSpreadsheet,
  FileCode,
  Image as ImageIcon,
  Presentation,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ExternalLink
} from 'lucide-react';
import { api, MemoryCitation } from '../services/api';
import { useConfirm } from '../hooks/useConfirm';

const states: Record<string, string> = {
  queued: '等待处理',
  interpreting: '逐页解读',
  organizing: '整理知识',
  ready: '已进入记忆',
  error: '解读失败'
};

function getFileIcon(ext: string) {
  const e = (ext || '').toLowerCase();
  if (['pdf'].includes(e)) return <FileText className="w-3.5 h-3.5 text-rose-400 shrink-0" />;
  if (['doc', 'docx'].includes(e)) return <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />;
  if (['ppt', 'pptx'].includes(e)) return <Presentation className="w-3.5 h-3.5 text-amber-400 shrink-0" />;
  if (['xlsx', 'csv'].includes(e)) return <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400 shrink-0" />;
  if (['png', 'jpg', 'jpeg', 'webp'].includes(e)) return <ImageIcon className="w-3.5 h-3.5 text-purple-400 shrink-0" />;
  if (['md', 'txt'].includes(e)) return <FileCode className="w-3.5 h-3.5 text-cyan-400 shrink-0" />;
  return <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />;
}

interface MemorySidebarProps {
  selectedDocumentId: string | null;
  onShowPanorama: () => void;
  onOpenDocument: (docId: string) => void;
  onOpenMemory: (citation: MemoryCitation) => Promise<void>;
}

/** 左侧栏「记忆与资料」：管理、检索与监控已纳入记忆的资料资产 */
export const MemorySidebar: React.FC<MemorySidebarProps> = ({
  onOpenDocument,
  onOpenMemory,
  selectedDocumentId,
  onShowPanorama
}) => {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [insights, setInsights] = useState<MemoryInsights | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterTab, setFilterTab] = useState<'all' | 'processing' | 'followup'>('all');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const confirm = useConfirm();

  const refresh = async () => {
    const [d, i] = await Promise.all([
      api.documents(),
      api.memoryInsights().catch(() => null)
    ]);
    setDocs(d);
    setInsights(i);
  };

  useEffect(() => {
    let live = true;
    const load = () => refresh().catch((e: any) => { if (live) setError(e.message); });
    void load();
    const timer = setInterval(load, 5000);
    return () => { live = false; clearInterval(timer); };
  }, []);

  const upload = async (files: FileList | null, replaces?: string) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    const failures: string[] = [];
    for (const file of Array.from(files)) {
      try { await api.uploadDocument(file, replaces); }
      catch (e: any) { failures.push(`${file.name}：${e.message}`); }
    }
    try { await refresh(); } catch (_) { /* 下轮轮询会刷新 */ }
    setError(failures.join('；'));
    setBusy(false);
    requestAnimationFrame(() => { if (feedRef.current) feedRef.current.scrollTop = 0; });
  };

  const removeDoc = async (d: DocumentInfo) => {
    const ok = await confirm({
      title: '移出记忆',
      scope: 'OpeniFLYTEK 项目自有记忆库',
      target: d.name,
      consequence: '该资料将从记忆中移除，相关自动跟进与知识条目不再引用它。',
      typeToConfirm: 'DELETE',
      variant: 'danger',
      confirmText: '移出记忆'
    });
    if (!ok) return;
    try {
      await api.deleteDocument(d.id);
      if (selectedDocumentId === d.id) onShowPanorama();
      await refresh();
    } catch (e: any) { setError(e.message); }
  };

  const retryDoc = async (id: string) => {
    try { await api.retryDocument(id); await refresh(); }
    catch (e: any) { setError(e.message); }
  };

  const fmtTime = (iso: string) => {
    try {
      const d = new Date(iso);
      const mm = (d.getMonth() + 1).toString().padStart(2, '0');
      const dd = d.getDate().toString().padStart(2, '0');
      const hh = d.getHours().toString().padStart(2, '0');
      const mi = d.getMinutes().toString().padStart(2, '0');
      return `${mm}-${dd} ${hh}:${mi}`;
    } catch (_) { return ''; }
  };

  const q = searchTerm.trim().toLowerCase();
  const allFilteredDocs = docs
    .filter((d) => !q || d.name.toLowerCase().includes(q))
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));

  const followups = (insights?.followups || []).filter(
    (t) => !q || t.item.toLowerCase().includes(q) || t.project.toLowerCase().includes(q)
  );

  const processingCount = docs.filter(
    (d) => d.status === 'queued' || d.status === 'interpreting' || d.status === 'organizing' || d.status === 'error'
  ).length;

  const displayedDocs = allFilteredDocs.filter((d) => {
    if (filterTab === 'processing') return d.status === 'queued' || d.status === 'interpreting' || d.status === 'organizing' || d.status === 'error';
    if (filterTab === 'followup') return false; // Handled in followup section
    return true;
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <button
        onClick={onShowPanorama}
        aria-current={!selectedDocumentId ? 'page' : undefined}
        className={`shrink-0 m-3 mb-0 p-2.5 rounded-lg border text-xs text-left transition-all ${
          !selectedDocumentId
            ? 'border-cyan-500/60 bg-cyan-500/10 text-viaim-primary font-medium shadow-[0_0_8px_rgba(6,182,212,0.1)]'
            : 'border-viaim-border text-viaim-textDim hover:text-viaim-primary hover:border-slate-700'
        }`}
      >
        ◎ 知识全景
      </button>

      {/* 上传区（点击或拖拽） */}
      <div className="shrink-0 p-3 border-b border-viaim-border">
        <label
          className="block p-2.5 border border-dashed border-cyan-700/70 rounded-lg cursor-pointer text-[11px] text-cyan-300 hover:bg-cyan-500/5 transition-colors"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); if (!busy) void upload(e.dataTransfer.files); }}
          title="上传后自动逐页解读并整理进记忆；PDF/PPT 最多 200 页、单文件 40MB"
        >
          <span className="flex items-center justify-center gap-1.5 font-medium">
            <Upload className="w-3.5 h-3.5" />
            {busy ? '正在上传…' : '上传或拖入资料（可多选）'}
          </span>
          <input
            type="file"
            multiple
            disabled={busy}
            className="hidden"
            accept=".pdf,.ppt,.pptx,.doc,.docx,.txt,.md,.csv,.xlsx,.png,.jpg,.jpeg,.webp"
            onChange={(e) => { void upload(e.target.files); e.target.value = ''; }}
          />
        </label>
        <div className="relative mt-2.5">
          <Search className="w-4 h-4 absolute left-3 top-2.5 text-viaim-textDim" />
          <input
            type="text"
            placeholder="检索资料名称、跟进事项..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-viaim-bg border border-viaim-border rounded-lg pl-9 pr-3 py-1.5 text-xs text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-cyan-500 transition-colors"
          />
        </div>

        {/* 筛选 Tab */}
        <div className="flex gap-1 mt-2.5 text-[11px]">
          <button
            onClick={() => setFilterTab('all')}
            className={`px-2 py-0.5 rounded transition-colors ${
              filterTab === 'all'
                ? 'bg-slate-800 text-cyan-300 font-medium'
                : 'text-viaim-textDim hover:text-viaim-textMain'
            }`}
          >
            全部 ({docs.length})
          </button>
          {(processingCount > 0 || filterTab === 'processing') && (
            <button
              onClick={() => setFilterTab('processing')}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition-colors ${
                filterTab === 'processing'
                  ? 'bg-slate-800 text-indigo-300 font-medium'
                  : 'text-indigo-400 hover:text-indigo-300'
              }`}
            >
              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
              处理与重试 ({processingCount})
            </button>
          )}
          {((insights?.followups.length || 0) > 0 || filterTab === 'followup') && (
            <button
              onClick={() => setFilterTab('followup')}
              className={`px-2 py-0.5 rounded transition-colors ${
                filterTab === 'followup'
                  ? 'bg-slate-800 text-cyan-300 font-medium'
                  : 'text-viaim-textDim hover:text-viaim-textMain'
              }`}
            >
              跟进 ({followups.length})
            </button>
          )}
        </div>
      </div>

      {error && (
        <p role="alert" className="shrink-0 mx-3 mt-2 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
          {error}
        </p>
      )}

      {/* 资料资产列表 */}
      <div ref={feedRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
        {displayedDocs.length === 0 && filterTab !== 'followup' && !followups.length ? (
          <div className="h-48 flex flex-col items-center justify-center text-viaim-textDim text-xs">
            <FileSearch className="w-8 h-8 stroke-1 mb-2 opacity-50" />
            <p>{q ? '没有匹配的资料或跟进事项' : '还没有上传资料'}</p>
            {!q && <p className="text-[10px] mt-1 opacity-70">上传后将自动解读并整理进记忆</p>}
          </div>
        ) : (
          <>
            {filterTab !== 'followup' && displayedDocs.map((d) => {
              const processing = d.status === 'queued' || d.status === 'interpreting' || d.status === 'organizing';
              return (
                <div
                  key={d.id}
                  className={`p-2.5 rounded-xl border transition-all duration-150 ${
                    selectedDocumentId === d.id
                      ? 'border-cyan-500/60 bg-cyan-950/20 shadow-[0_0_10px_rgba(6,182,212,0.12)] ring-1 ring-cyan-500/40'
                      : 'border-viaim-border bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div className="mt-0.5 p-1 rounded bg-slate-800/80 border border-slate-700/50">
                      {getFileIcon(d.ext)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <button
                        onClick={() => onOpenDocument(d.id)}
                        className="w-full text-left font-medium text-xs text-viaim-textMain hover:text-cyan-300 break-words transition-colors cursor-pointer"
                        title={d.name}
                      >
                        {d.name}
                      </button>

                      {/* 状态徽标与元数据 */}
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10px] text-viaim-textDim">
                        <span>{fmtTime(d.uploadedAt)}</span>
                        {d.materialDate && <span>· 日期 {d.materialDate}</span>}
                        {d.pageCount > 0 && <span>· {d.interpreted}/{d.pageCount} 页</span>}
                      </div>

                      {/* 处理中进度条 */}
                      {processing && (
                        <div className="mt-1.5 space-y-1">
                          <div className="flex justify-between items-center text-[10px] text-indigo-300">
                            <span className="flex items-center gap-1">
                              <RefreshCw className="w-2.5 h-2.5 animate-spin" />
                              {states[d.status] || d.status}
                            </span>
                            {d.pageCount > 0 && (
                              <span>{Math.round((d.interpreted / Math.max(1, d.pageCount)) * 100)}%</span>
                            )}
                          </div>
                          <div className="w-full bg-slate-800 rounded-full h-1 overflow-hidden">
                            <div
                              className="bg-indigo-500 h-1 rounded-full transition-all duration-300"
                              style={{
                                width: `${d.pageCount > 0 ? Math.max(8, Math.round((d.interpreted / d.pageCount) * 100)) : 100}%`
                              }}
                            />
                          </div>
                        </div>
                      )}

                      {/* 就绪徽标 */}
                      {d.status === 'ready' && !processing && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-emerald-400 font-medium">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          <span>已进入记忆</span>
                        </div>
                      )}

                      {/* 排队中徽标 */}
                      {d.status === 'queued' && (
                        <div className="mt-1 flex items-center gap-1 text-[10px] text-slate-400">
                          <Clock className="w-3 h-3 shrink-0" />
                          <span>等待排队处理</span>
                        </div>
                      )}

                      {/* 失败提示 */}
                      {d.error && (
                        <div className="mt-1 p-1.5 rounded bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300 break-all">
                          <p className="flex items-center gap-1 font-medium">
                            <AlertTriangle className="w-3 h-3 shrink-0" /> 解读失败
                          </p>
                          <p className="mt-0.5 opacity-90">{d.error}</p>
                        </div>
                      )}

                      {/* 操作栏 */}
                      <div className="flex items-center gap-2.5 mt-2 pt-1.5 border-t border-slate-800/80 text-[10px] text-viaim-textDim">
                        <button
                          onClick={() => onOpenDocument(d.id)}
                          className="hover:text-cyan-300 cursor-pointer"
                        >
                          查看
                        </button>
                        {d.status === 'ready' && (
                          <label className={`cursor-pointer ${updatingId === d.id ? 'opacity-50 pointer-events-none' : ''} hover:text-cyan-300`}>
                            {updatingId === d.id ? '上传中…' : '更新版本'}
                            <input
                              type="file"
                              className="hidden"
                              disabled={updatingId === d.id}
                              onChange={(e) => {
                                const f = e.target.files;
                                setUpdatingId(d.id);
                                void upload(f, d.id).finally(() => setUpdatingId(null));
                                e.target.value = '';
                              }}
                            />
                          </label>
                        )}
                        <a
                          href={api.documentFile(d.id, 'original')}
                          className="flex items-center gap-0.5 hover:text-cyan-300"
                          title="下载原文件"
                        >
                          <Download className="w-2.5 h-2.5" /> 原件
                        </a>
                        {(d.error || !['queued', 'interpreting', 'organizing', 'ready'].includes(d.status)) && (
                          <button
                            onClick={() => void retryDoc(d.id)}
                            className="flex items-center gap-0.5 text-amber-300 hover:text-amber-200 cursor-pointer"
                          >
                            <RotateCcw className="w-2.5 h-2.5" /> 重试
                          </button>
                        )}
                        <button
                          onClick={() => void removeDoc(d)}
                          className="ml-auto flex items-center gap-0.5 text-slate-500 hover:text-red-400 cursor-pointer transition-colors"
                          title="移出记忆库"
                        >
                          <Trash2 className="w-2.5 h-2.5" /> 移出
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 跨来源自动跟进（记忆自动核对的结果） */}
            {(filterTab === 'all' || filterTab === 'followup') && followups.length > 0 && (
              <div className="pt-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold text-cyan-300/90 mb-1.5">
                  <Brain className="w-3 h-3" /> 自动跟进与变化（跨来源核对）
                </p>
                {followups.map((t) => (
                  <div key={t.id} className="mb-1.5 p-2.5 rounded-xl bg-slate-900/60 border border-viaim-border text-[11px]">
                    <p className="text-viaim-textMain font-medium">{t.item}</p>
                    <p className="mt-1 text-[10px] text-viaim-textDim">
                      {t.project} · 责任人 {t.owners.join('、') || '未明确'} · {t.dueDate || '期限未明确'}
                      {t.overdue ? ' · 已过期限' : ''}
                    </p>
                    {t.history.slice(0, 2).map((h) => {
                      const citation = insights?.citations.find((c) => c.chunkId === h.chunkId);
                      return citation ? (
                        <button
                          key={h.id}
                          onClick={() => void onOpenMemory(citation).catch((e: any) => setError(e.message))}
                          className="mt-1.5 text-[10px] text-cyan-300 hover:text-viaim-primary flex items-center gap-1 cursor-pointer"
                        >
                          <ExternalLink className="w-2.5 h-2.5" />
                          核对来源{h.observedAt ? ` · ${fmtTime(h.observedAt)}` : ''}
                        </button>
                      ) : null;
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      <div className="shrink-0 px-3 py-2 border-t border-viaim-border text-[10px] text-viaim-textDim">
        上传后自动解读整理 · 每份最多 40MB / 200 页 · PPT/DOC 需 LibreOffice
      </div>
    </div>
  );
};

// 局部类型引用（与 services/api 保持一致）
type DocumentInfo = Awaited<ReturnType<typeof api.documents>>[number];
type MemoryInsights = Awaited<ReturnType<typeof api.memoryInsights>>;
