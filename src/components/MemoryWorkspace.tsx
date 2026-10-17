import { useEffect, useState, useMemo } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Download,
  FileText,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Search,
  CheckCircle2,
  HelpCircle,
  Brain,
  ZoomIn,
  ZoomOut,
  Maximize2
} from 'lucide-react';
import { api, DocumentDetail, MemoryCitation } from '../services/api';
import { KnowledgePanorama } from './KnowledgePanorama';

const states: Record<string, string> = {
  queued: '等待处理',
  interpreting: '逐页解读',
  organizing: '整理知识',
  ready: '已进入记忆',
  error: '解读失败'
};

const basisMeta: Record<string, { label: string; badgeClass: string; borderClass: string }> = {
  fact: {
    label: '材料事实',
    badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    borderClass: 'border-l-emerald-500'
  },
  interpretation: {
    label: '解释分析',
    badgeClass: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
    borderClass: 'border-l-cyan-500'
  },
  synthesis: {
    label: '模型归纳',
    badgeClass: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
    borderClass: 'border-l-purple-500'
  }
};

type Selection = { id: string; page?: number; request: number; quote?: string; fromTitle?: string };

export function MemoryWorkspace({
  selection,
  onSelect,
  onOverview,
  onOpenMemory
}: {
  selection: Selection | null;
  onSelect: (id: string) => void;
  onOverview: () => void;
  onOpenMemory: (c: MemoryCitation) => Promise<void>;
}) {
  return (
    <main aria-label="记忆与资料工作台" className="flex flex-col flex-1 min-h-0 min-w-0 bg-slate-950/30 select-text">
      {selection ? (
        <DocumentKnowledge key={selection.id} selection={selection} onOverview={onOverview} />
      ) : (
        <KnowledgePanorama onSelect={onSelect} onOpenMemory={onOpenMemory} />
      )}
    </main>
  );
}

function renderHighlightedText(text: string, highlight?: string) {
  if (!text) return '';
  const trimmed = (highlight || '').trim();
  if (!trimmed || trimmed.length < 3 || !text.includes(trimmed)) {
    return text;
  }
  const parts = text.split(trimmed);
  return parts.flatMap((part, i) => [
    part,
    i < parts.length - 1 ? (
      <mark
        key={i}
        className="bg-amber-400/25 text-amber-200 ring-1 ring-amber-400/60 rounded px-1 font-semibold animate-pulse"
      >
        {trimmed}
      </mark>
    ) : null
  ]);
}

function DocumentKnowledge({ selection, onOverview }: { selection: Selection; onOverview: () => void }) {
  const [detail, setDetail] = useState<DocumentDetail | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(selection.page || 1);
  const [view, setView] = useState<'knowledge' | 'source'>(selection.page ? 'source' : 'knowledge');
  const [query, setQuery] = useState('');
  const [imageZoom, setImageZoom] = useState(false);
  const [selectedSection, setSelectedSection] = useState<number | null>(null);

  useEffect(() => {
    setPage(selection.page || 1);
    setView(selection.page ? 'source' : 'knowledge');
  }, [selection.request, selection.page]);

  useEffect(() => {
    let live = true, busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await api.document(selection.id);
        if (live) {
          setDetail(next);
          setError('');
          setPage((p) => (next.pages.some((x) => x.number === p) ? p : next.pages[0]?.number || 1));
        }
      } catch (e: any) {
        if (live) {
          setError(e.message);
          setDetail(null);
        }
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selection.id]);

  // 键盘快捷翻页
  useEffect(() => {
    if (view !== 'source' || !detail?.pages.length) return;
    const handler = (e: KeyboardEvent) => {
      if (['input', 'textarea', 'select'].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) return;
      if (e.key === 'ArrowLeft') {
        const idx = detail.pages.findIndex((p) => p.number === page);
        if (idx > 0) setPage(detail.pages[idx - 1].number);
      } else if (e.key === 'ArrowRight') {
        const idx = detail.pages.findIndex((p) => p.number === page);
        if (idx >= 0 && idx < detail.pages.length - 1) setPage(detail.pages[idx + 1].number);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, page, detail?.pages]);

  const current = detail?.pages.find((p) => p.number === page);
  const totalPages = detail?.pages.length || 0;
  const currentPageIndex = detail?.pages.findIndex((p) => p.number === page) ?? -1;

  const filteredKnowledge = useMemo(() => {
    if (!detail?.knowledge) return [];
    if (!query.trim() && selectedSection !== null && detail.knowledge[selectedSection]) {
      const g = detail.knowledge[selectedSection];
      return [{
        overview: g.overview,
        units: g.units.filter((u) => !query.trim() || `${u.question} ${u.answer}`.toLowerCase().includes(query.trim().toLowerCase()))
      }];
    }
    return detail.knowledge.map((g) => ({
      overview: g.overview,
      units: g.units.filter((u) => !query.trim() || `${u.question} ${u.answer}`.toLowerCase().includes(query.trim().toLowerCase()))
    })).filter((g) => g.units.length > 0 || !query.trim());
  }, [detail?.knowledge, selectedSection, query]);

  const totalFilteredUnits = filteredKnowledge.reduce((sum, g) => sum + g.units.length, 0);

  return (
    <>
      <header className="shrink-0 p-5 border-b border-viaim-border space-y-3 bg-slate-900/40">
        <div className="flex items-center justify-between">
          <button onClick={onOverview} className="text-xs text-cyan-300 flex gap-1.5 items-center hover:underline">
            <ArrowLeft size={14} />
            知识全景
          </button>
          {selection.fromTitle && (
            <span className="text-[11px] text-amber-300/90 bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
              正在核对资料《{selection.fromTitle}》
            </span>
          )}
        </div>

        <h1 className="font-semibold text-lg break-words text-viaim-textMain">{detail?.name || '资料知识'}</h1>

        {detail && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-viaim-textDim flex items-center gap-2">
              <span className={`px-2 py-0.5 rounded text-[11px] ${detail.status === 'ready' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-indigo-500/15 text-indigo-300'}`}>
                {states[detail.status] || detail.status}
              </span>
              <span>· {detail.interpreted}/{detail.pageCount} 页／段落组</span>
              <span>· 材料日期 {detail.materialDate || '未知'}</span>
            </p>
            <div className="flex flex-wrap gap-3 text-xs">
              <a href={api.documentFile(detail.id, 'original')} className="text-cyan-300 flex gap-1 items-center hover:underline">
                <Download size={13} />
                原文件
              </a>
              {detail.status === 'ready' && (
                <a href={api.documentFile(detail.id, 'knowledge')} className="text-cyan-300 flex gap-1 items-center hover:underline">
                  <Download size={13} />
                  下载整理后的知识
                </a>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2 pt-1" role="tablist" aria-label="资料阅读方式">
          {(['knowledge', 'source'] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={`rounded-lg px-3.5 py-2 text-xs flex gap-1.5 items-center transition-all cursor-pointer ${
                view === v
                  ? 'bg-cyan-500/15 text-viaim-primary font-medium border border-cyan-500/30'
                  : 'text-viaim-textDim hover:bg-slate-800'
              }`}
            >
              {v === 'knowledge' ? <BookOpen size={14} /> : <FileText size={14} />}
              {v === 'knowledge' ? '知识内容' : '原文与页图'}
            </button>
          ))}
        </div>
      </header>

      <div
        className="flex-1 min-h-0 overflow-y-auto p-5 space-y-4 custom-scrollbar"
        role="tabpanel"
        aria-label={view === 'knowledge' ? '知识内容' : '原文与页图'}
      >
        {error && <p role="alert" className="text-sm text-amber-300">{error}。可返回知识全景选择其他资料。</p>}
        {!detail && !error && (
          <p className="text-sm text-viaim-textDim flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" />
            正在读取资料…
          </p>
        )}
        {detail?.error && <p role="status" className="text-sm text-amber-300">{detail.error}</p>}

        {detail && view === 'knowledge' && (
          <>
            {detail.status !== 'ready' && (
              <p className="rounded-lg bg-indigo-500/10 p-3 text-xs text-viaim-primary flex items-center gap-2">
                <Sparkles size={14} className="animate-pulse shrink-0" />
                资料正在自动处理，知识内容会随进度更新。全部整理完成后才会进入记忆。
              </p>
            )}

            {/* 检索条 */}
            <div className="relative">
              <Search size={15} className="absolute left-3 top-3 text-viaim-textDim" />
              <input
                aria-label="搜索本资料知识"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索这份资料中的知识…"
                className="w-full rounded-lg border border-viaim-border bg-slate-900 py-2 pl-9 pr-3 text-sm text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-cyan-500"
              />
            </div>

            {/* 章节/大纲锚点导航 */}
            {detail.knowledge.length > 1 && !query && (
              <div className="flex gap-1.5 overflow-x-auto pb-1 custom-scrollbar text-xs">
                <button
                  onClick={() => setSelectedSection(null)}
                  className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                    selectedSection === null
                      ? 'bg-cyan-500/20 text-viaim-primary border border-cyan-500/30'
                      : 'bg-slate-900/60 text-viaim-textDim hover:text-viaim-textMain'
                  }`}
                >
                  全部章节 ({detail.knowledge.reduce((acc, g) => acc + g.units.length, 0)})
                </button>
                {detail.knowledge.map((g, idx) => (
                  <button
                    key={idx}
                    onClick={() => setSelectedSection(selectedSection === idx ? null : idx)}
                    className={`px-2.5 py-1 rounded-full whitespace-nowrap transition-colors ${
                      selectedSection === idx
                        ? 'bg-cyan-500/20 text-viaim-primary border border-cyan-500/30'
                        : 'bg-slate-900/60 text-viaim-textDim hover:text-viaim-textMain'
                    }`}
                  >
                    第 {idx + 1} 节 · {g.overview.length > 14 ? g.overview.slice(0, 14) + '…' : g.overview}
                  </button>
                ))}
              </div>
            )}

            <p className="text-xs text-viaim-textDim">
              {totalFilteredUnits} 条知识 · 模型整理内容请结合来源核对
            </p>

            {/* 知识列表 */}
            {filteredKnowledge.map((g, gIdx) => (
              <section key={gIdx} className="space-y-3 pt-2">
                {!query && (
                  <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-viaim-textDim leading-relaxed flex gap-2 items-start">
                    <span className="font-semibold text-cyan-300 shrink-0">本段总括:</span>
                    <span>{g.overview}</span>
                  </div>
                )}
                {g.units.map((u, i) => {
                  const meta = basisMeta[u.basis] || basisMeta.fact;
                  return (
                    <article
                      key={i}
                      className={`p-4 border border-viaim-border rounded-xl bg-slate-900/50 space-y-3 border-l-4 ${meta.borderClass} hover:bg-slate-900/70 transition-colors`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="text-sm font-semibold text-viaim-textMain leading-snug">
                          {u.question}
                        </h2>
                        <span className={`px-2 py-0.5 rounded text-[10px] border whitespace-nowrap ${meta.badgeClass}`}>
                          {meta.label}
                        </span>
                      </div>
                      <p className="text-sm leading-7 whitespace-pre-wrap break-words text-slate-300">
                        {renderHighlightedText(u.answer, selection.quote)}
                      </p>
                      <div className="flex gap-2 flex-wrap items-center text-xs pt-1 border-t border-slate-800/60">
                        <span className="text-viaim-textDim text-[11px]">依据来源:</span>
                        {u.pages.map((n) => (
                          <button
                            key={n}
                            className="text-cyan-300 rounded bg-cyan-500/10 px-2 py-1 hover:bg-cyan-500/20 transition-colors cursor-pointer"
                            onClick={() => {
                              setPage(n);
                              setView('source');
                            }}
                          >
                            核对来源 · {detail.pages.find((p) => p.number === n)?.label || `第 ${n} 页`}
                          </button>
                        ))}
                      </div>
                    </article>
                  );
                })}
              </section>
            ))}

            {!totalFilteredUnits && (
              <p className="py-8 text-center text-sm text-viaim-textDim">
                {query
                  ? '没有匹配的知识内容'
                  : detail.status === 'ready'
                  ? '暂无整理出的知识单元，可查看原文'
                  : '知识整理尚未完成，无需重复上传'}
              </p>
            )}
          </>
        )}

        {detail && view === 'source' && (
          <div className="space-y-4">
            {/* 顶部翻页与位置选择条 */}
            <div className="p-3 rounded-xl bg-slate-900/70 border border-viaim-border flex flex-wrap items-center justify-between gap-3">
              {detail.pages.length > 0 ? (
                <div className="flex items-center gap-3 flex-1 min-w-[260px]">
                  <label className="text-xs text-viaim-textDim shrink-0">
                    来源位置
                    <select
                      aria-label="来源位置"
                      className="ml-2 bg-slate-800 px-3 py-1.5 rounded text-xs text-viaim-textMain border border-slate-700 focus:outline-none focus:border-cyan-500"
                      value={page}
                      onChange={(e) => setPage(Number(e.target.value))}
                    >
                      {detail.pages.map((p) => (
                        <option key={p.number} value={p.number}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </label>

                  {/* 上下页翻页快捷按钮 */}
                  <div className="flex items-center gap-1 text-xs">
                    <button
                      disabled={currentPageIndex <= 0}
                      onClick={() => setPage(detail.pages[currentPageIndex - 1].number)}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="上一页 (←)"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <span className="text-[11px] text-viaim-textDim px-1">
                      {currentPageIndex + 1} / {totalPages}
                    </span>
                    <button
                      disabled={currentPageIndex >= totalPages - 1}
                      onClick={() => setPage(detail.pages[currentPageIndex + 1].number)}
                      className="p-1.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      title="下一页 (→)"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-viaim-textDim">原文尚在解析中。</p>
              )}

              {current?.image && (
                <button
                  onClick={() => setImageZoom(!imageZoom)}
                  className="text-xs text-cyan-300 hover:text-cyan-200 flex items-center gap-1 ml-auto"
                >
                  <Maximize2 size={13} />
                  {imageZoom ? '适应宽度' : '放大图片'}
                </button>
              )}
            </div>

            {/* 图文并排对照区（大屏双栏，小屏自动堆叠） */}
            <div className={`grid gap-4 items-start ${current?.image ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'}`}>
              {/* 左侧：原页图像 */}
              {current?.image && (
                <div className="space-y-2 sticky top-0">
                  <div className="p-2 rounded-xl bg-slate-900 border border-viaim-border overflow-hidden flex flex-col items-center">
                    <div className="w-full flex justify-between items-center px-1 pb-2 text-[11px] text-viaim-textDim border-b border-slate-800">
                      <span>原件高清视图 · {current.label}</span>
                      <span className="text-[10px] text-slate-500">点击上方按钮放大，滚动查看细节</span>
                    </div>
                    <div className={`w-full overflow-auto max-h-[720px] custom-scrollbar p-1 bg-slate-950/40 rounded mt-1`}>
                      <img
                        src={api.documentFile(detail.id, 'page', page)}
                        alt={`${detail.name} ${current.label}`}
                        className={`rounded-lg bg-white shadow-lg transition-all duration-200 ${
                          imageZoom ? 'w-auto max-w-none' : 'w-full object-contain'
                        }`}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 右侧：提取文本与视觉解读 */}
              <div className="space-y-4">
                {current && (
                  <section className="p-4 rounded-xl bg-slate-900/50 border border-viaim-border">
                    <h2 className="text-sm font-semibold mb-2.5 flex items-center justify-between text-viaim-textMain">
                      <span>来源文字</span>
                      <span className="text-[10px] text-viaim-textDim font-normal">{current.label}</span>
                    </h2>
                    <pre className="text-sm leading-7 whitespace-pre-wrap break-words font-sans text-slate-200">
                      {renderHighlightedText(current.text, selection.quote) || '本页无可提取文字，请核对页图。'}
                    </pre>
                  </section>
                )}

                {current?.ledger && (
                  <section className="p-4 rounded-xl bg-slate-900/50 border border-viaim-border border-t-2 border-t-cyan-500/50 space-y-3">
                    <div>
                      <h2 className="text-sm font-semibold text-cyan-300 flex items-center gap-1.5 mb-1">
                        <Sparkles size={14} />
                        页面视觉解读
                      </h2>
                      <p className="text-[11px] text-viaim-textDim">
                        以下为模型视觉识别，可能存在误读，请结合左侧原页核对。
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-slate-400">提取事实与数据：</p>
                      <p className="text-sm leading-7 whitespace-pre-wrap text-slate-300">
                        {renderHighlightedText(current.ledger.facts, selection.quote)}
                      </p>
                    </div>

                    {current.ledger.charts && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-800">
                        <p className="text-xs font-semibold text-slate-400">图表与布局关系：</p>
                        <p className="text-sm leading-7 whitespace-pre-wrap text-slate-300">
                          {renderHighlightedText(current.ledger.charts, selection.quote)}
                        </p>
                      </div>
                    )}
                  </section>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
