import React, { useEffect, useRef, useState } from 'react';
import {
  Search,
  Upload,
  Bot,
  CircleUser,
  RotateCcw,
  Download,
  Trash2,
  RefreshCw,
  Brain,
  FileSearch
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

interface MemorySidebarProps {
  selectedDocumentId:string|null;
  onShowPanorama:()=>void;
  onOpenDocument: (docId: string) => void;
  onOpenMemory: (citation: MemoryCitation) => Promise<void>;
}

/** 左侧栏「记忆与资料」标签：以会话记录的方式管理、检索、操作上传的资料 */
export const MemorySidebar: React.FC<MemorySidebarProps> = ({ onOpenDocument, onOpenMemory, selectedDocumentId, onShowPanorama }) => {
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [insights, setInsights] = useState<MemoryInsights | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
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
    // 新资料入列后滚到顶部（会话按时间倒序，最新在最上）
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
      if(selectedDocumentId===d.id)onShowPanorama();
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
  const filteredDocs = docs
    .filter((d) => !q || d.name.toLowerCase().includes(q))
    .sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
  const followups = (insights?.followups || []).filter(
    (t) => !q || t.item.toLowerCase().includes(q) || t.project.toLowerCase().includes(q)
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <button onClick={onShowPanorama} aria-current={!selectedDocumentId?'page':undefined} className={`shrink-0 m-3 mb-0 p-2.5 rounded-lg border text-xs text-left ${!selectedDocumentId?'border-cyan-500/60 bg-cyan-500/10 text-viaim-primary':'border-viaim-border text-viaim-textDim hover:text-viaim-primary'}`}>◎ 知识全景</button>
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
      </div>

      {error && (
        <p role="alert" className="shrink-0 mx-3 mt-2 px-2 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[11px]">
          {error}
        </p>
      )}

      {/* 会话记录式资料流（最新在上） */}
      <div ref={feedRef} className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2.5 custom-scrollbar">
        {filteredDocs.length === 0 && !followups.length ? (
          <div className="h-48 flex flex-col items-center justify-center text-viaim-textDim text-xs">
            <FileSearch className="w-8 h-8 stroke-1 mb-2 opacity-50" />
            <p>{q ? '没有匹配的资料或跟进事项' : '还没有上传资料'}</p>
            {!q && <p className="text-[10px] mt-1 opacity-70">上传后将自动解读并整理进记忆</p>}
          </div>
        ) : (
          <>
            {filteredDocs.map((d) => {
              const processing = d.status === 'queued' || d.status === 'interpreting' || d.status === 'organizing';
              return (
                <div key={d.id} className={`space-y-1.5 rounded-xl ${selectedDocumentId===d.id?'ring-1 ring-cyan-500/60 bg-cyan-500/5':''}`}>
                  {/* 用户侧：上传动作 */}
                  <div className="flex items-start justify-end gap-1.5">
                    <div className="max-w-[85%] px-2.5 py-1.5 rounded-xl rounded-tr-sm bg-viaim-primary/15 border border-viaim-primary/30 text-[11px] text-viaim-textMain">
                      上传了资料<span className="font-semibold">《{d.name}》</span>
                      <span className="ml-1 text-[9px] text-viaim-textDim">{fmtTime(d.uploadedAt)}</span>
                    </div>
                    <CircleUser className="w-4 h-4 mt-0.5 text-viaim-textDim shrink-0" />
                  </div>
                  {/* 系统侧：解读状态 + 操作 */}
                  <div className="flex items-start gap-1.5">
                    <Bot className="w-4 h-4 mt-0.5 text-cyan-400 shrink-0" />
                    <div className="min-w-0 flex-1 px-2.5 py-2 rounded-xl rounded-tl-sm bg-viaim-card/80 border border-viaim-border text-[11px]">
                      <button
                        onClick={() => onOpenDocument(d.id)}
                        className="text-left text-cyan-300 hover:text-viaim-primary break-all cursor-pointer"
                        title="在中栏查看知识与原文"
                      >
                        {d.name}
                      </button>
                      <p className={`mt-1 flex items-center gap-1 ${d.error ? 'text-amber-300' : processing ? 'text-indigo-300' : 'text-emerald-500'}`}>
                        {processing && <RefreshCw className="w-3 h-3 animate-spin" />}
                        {states[d.status] || d.status}
                        {d.pageCount > 0 && ` · ${d.interpreted}/${d.pageCount} 页`}
                      </p>
                      {d.error && <p className="mt-1 text-amber-300/90 break-all">{d.error}</p>}
                      <div className="flex items-center gap-2.5 mt-2 text-[10px] text-viaim-textMuted">
                        <button onClick={() => onOpenDocument(d.id)} className="hover:text-cyan-300 cursor-pointer">查看</button>
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
                        <a href={api.documentFile(d.id, 'original')} className="flex items-center gap-0.5 hover:text-cyan-300">
                          <Download className="w-3 h-3" /> 原文件
                        </a>
                        {(d.error || !['queued', 'interpreting', 'organizing', 'ready'].includes(d.status)) && (
                          <button onClick={() => void retryDoc(d.id)} className="flex items-center gap-0.5 hover:text-cyan-300 cursor-pointer">
                            <RotateCcw className="w-3 h-3" /> 重试
                          </button>
                        )}
                        <button onClick={() => void removeDoc(d)} className="flex items-center gap-0.5 hover:text-red-400 cursor-pointer">
                          <Trash2 className="w-3 h-3" /> 移出
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}

            {/* 跨来源自动跟进（记忆自动核对的结果） */}
            {followups.length > 0 && (
              <div className="pt-2">
                <p className="flex items-center gap-1 text-[10px] font-semibold text-cyan-300/90 mb-1.5">
                  <Brain className="w-3 h-3" /> 自动跟进与变化（跨来源核对）
                </p>
                {followups.map((t) => (
                  <div key={t.id} className="mb-1.5 px-2.5 py-2 rounded-xl bg-viaim-card/60 border border-viaim-border text-[11px]">
                    <p className="text-viaim-textMain">{t.item}</p>
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
                          className="mt-1 text-[10px] text-cyan-300 hover:text-viaim-primary cursor-pointer"
                        >
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
