import { useEffect, useState, useMemo } from 'react';
import {
  BookOpen,
  FileText,
  Mic,
  Network,
  Search,
  LayoutGrid,
  Layers,
  Sparkles,
  ExternalLink,
  Tag,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react';
import { api, DocumentInfo, MemoryCitation, MemoryPanorama, MemoryInsights } from '../services/api';

const typeNames: Record<string, string> = {
  concept: '概念',
  technology: '技术',
  product: '产品',
  project: '项目',
  organization: '单位',
  person: '人物'
};

const typeColors: Record<string, { badge: string; stroke: string; fill: string }> = {
  project: { badge: 'text-amber-400 bg-amber-500/10 border-amber-500/30', stroke: '#F59E0B', fill: '#FEF3C7' },
  technology: { badge: 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30', stroke: '#06B6D4', fill: '#CFFAFE' },
  product: { badge: 'text-purple-300 bg-purple-500/10 border-purple-500/30', stroke: '#A855F7', fill: '#F3E8FF' },
  concept: { badge: 'text-indigo-300 bg-indigo-500/10 border-indigo-500/30', stroke: '#6366F1', fill: '#E0E7FF' },
  organization: { badge: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30', stroke: '#10B981', fill: '#D1FAE5' },
  person: { badge: 'text-rose-400 bg-rose-500/10 border-rose-500/30', stroke: '#F43F5E', fill: '#FFE4E6' }
};

export function KnowledgePanorama({
  onSelect,
  onOpenMemory
}: {
  onSelect: (id: string) => void;
  onOpenMemory: (c: MemoryCitation) => Promise<void>;
}) {
  const [data, setData] = useState<MemoryPanorama | null>(null);
  const [docs, setDocs] = useState<DocumentInfo[]>([]);
  const [error, setError] = useState('');
  const [insights, setInsights] = useState<MemoryInsights | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [viewMode, setViewMode] = useState<'graph' | 'matrix'>('graph');
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);

  useEffect(() => {
    let live = true, busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const [next, files, tracking] = await Promise.all([
          api.memoryPanorama(),
          api.documents(),
          api.memoryInsights()
        ]);
        if (live) {
          setData(next);
          setDocs(files);
          setInsights(tracking);
          setError('');
          setTopicId((id) => (next.topics.some((t) => t.id === id) ? id : null));
        }
      } catch (e: any) {
        if (live) setError(e.message);
      } finally {
        busy = false;
      }
    };
    void load();
    const timer = setInterval(load, 10000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);

  const selected = data?.topics.find((t) => t.id === topicId);
  const q = query.trim().toLowerCase();
  const topics = (data?.topics || []).filter((t) => !q || `${t.name} ${t.scope}`.toLowerCase().includes(q));
  const sources = (data?.sources || []).filter(
    (s) =>
      (!selected || selected.sourceIds.includes(s.id)) &&
      (!q || s.title.toLowerCase().includes(q) || topics.some((t) => t.sourceIds.includes(s.id)))
  );
  const pendingDocs = docs.filter((d) => d.status !== 'ready');

  const openSource = (s: MemoryPanorama['sources'][number]) => {
    if (s.type === 'document') onSelect(s.id);
    else void onOpenMemory(s.citation).catch((e) => setError(e.message));
  };

  const nodes = topics.length
    ? topics.slice(0, 8).map((t) => ({
        id: t.id,
        name: t.name,
        type: t.type,
        sourceIds: t.sourceIds,
        subtitle: `${typeNames[t.type] || t.type} · ${t.sourceIds.length} 个来源`,
        scope: t.scope,
        action: () => setTopicId(t.id === topicId ? null : t.id),
        active: t.id === topicId
      }))
    : sources.slice(0, 8).map((s) => ({
        id: s.id,
        name: s.title,
        type: s.type,
        sourceIds: [s.id],
        subtitle: s.type === 'document' ? '资料' : '会议',
        scope: '',
        action: () => openSource(s),
        active: false
      }));

  // 计算节点位置与跨主题关联边
  const { nodePositions, interLinks } = useMemo(() => {
    const pos = new Map<string, { x: number; y: number }>();
    const n = nodes.length;
    nodes.forEach((node, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const x = 320 + Math.cos(angle) * 224;
      const y = 150 + Math.sin(angle) * 104;
      pos.set(node.id, { x, y });
    });

    // 跨节点关联连线：如果两个主题节点共享同一来源，绘制轻微的交叉连线
    const links: Array<{ fromId: string; toId: string; x1: number; y1: number; x2: number; y2: number }> = [];
    if (topics.length > 0) {
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i], b = nodes[j];
          const shared = a.sourceIds?.some((id) => b.sourceIds?.includes(id));
          if (shared) {
            const p1 = pos.get(a.id)!, p2 = pos.get(b.id)!;
            links.push({ fromId: a.id, toId: b.id, x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
          }
        }
      }
    }
    return { nodePositions: pos, interLinks: links };
  }, [nodes, topics.length]);

  return (
    <>
      <header className="p-5 border-b border-viaim-border shrink-0 bg-slate-900/40">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Network className="text-cyan-300" size={20} />
            <h1 className="text-lg font-semibold text-viaim-textMain">知识全景</h1>
          </div>
          {data && (
            <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg border border-slate-700 text-xs">
              <button
                onClick={() => setViewMode('graph')}
                className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                  viewMode === 'graph' ? 'bg-cyan-500/20 text-viaim-primary font-medium' : 'text-viaim-textDim hover:text-viaim-textMain'
                }`}
              >
                <Layers size={13} />
                拓扑星系
              </button>
              <button
                onClick={() => setViewMode('matrix')}
                className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                  viewMode === 'matrix' ? 'bg-cyan-500/20 text-viaim-primary font-medium' : 'text-viaim-textDim hover:text-viaim-textMain'
                }`}
              >
                <LayoutGrid size={13} />
                知识矩阵
              </button>
            </div>
          )}
        </div>
        <p className="text-xs text-viaim-textDim mt-2">
          从资料与会议中自动积累 · 点击主题探索来源，点击资料阅读知识
        </p>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto p-5 space-y-5 custom-scrollbar">
        {error && (
          <p role="alert" className="text-xs text-amber-300 bg-amber-500/10 p-2.5 rounded-lg border border-amber-500/30">
            {error}
            {data ? '，当前显示上次成功加载的全景。' : ''}
          </p>
        )}

        {!data && !error && (
          <p className="text-sm text-viaim-textDim flex items-center gap-2">
            <Sparkles size={16} className="animate-spin text-cyan-300" />
            正在汇集已有知识…
          </p>
        )}

        {data && (
          <>
            {/* 统计指标卡 */}
            <div className="grid grid-cols-2 xl:grid-cols-4 gap-2.5">
              {[
                [data.totals.documents, '已归纳资料', '份'],
                [data.totals.meetings, '沉淀会议', '场'],
                [data.totals.knowledgeUnits, '核心知识单元', '条'],
                [data.topicCount, '实体与主题', '个']
              ].map(([n, label, unit]) => (
                <div key={label} className="rounded-xl border border-viaim-border bg-slate-900/60 p-3.5 hover:border-slate-700 transition-colors">
                  <div className="flex items-baseline gap-1">
                    <p className="text-2xl font-bold text-viaim-textMain tracking-tight">{n}</p>
                    <span className="text-xs text-viaim-textDim">{unit}</span>
                  </div>
                  <p className="text-xs text-viaim-textDim mt-1">{label}</p>
                </div>
              ))}
            </div>

            {/* 全景主视区：拓扑图 vs 矩阵 */}
            {viewMode === 'graph' ? (
              <section className="rounded-2xl border border-cyan-800/40 bg-gradient-to-b from-cyan-950/20 via-slate-950/40 to-slate-950/60 overflow-hidden shadow-inner">
                <div className="flex justify-between items-center p-4 pb-0 text-xs">
                  <span className="text-viaim-primary font-medium flex items-center gap-1.5">
                    <Sparkles size={13} />
                    {topics.length ? '主题关联拓扑' : '来源分布'}
                  </span>
                  <span className="text-viaim-textDim text-[11px]">
                    {nodes.length ? `展示前 ${nodes.length} 个核心节点 · 点击可按主题筛选` : ''}
                  </span>
                </div>

                {nodes.length ? (
                  <svg viewBox="0 0 640 300" className="w-full select-none" aria-label="知识主题与来源分布图">
                    <defs>
                      <radialGradient id="centerGlow" cx="50%" cy="50%" r="50%">
                        <stop offset="0%" stopColor="#4F6BEB" stopOpacity="0.25" />
                        <stop offset="100%" stopColor="#0A0E17" stopOpacity="0" />
                      </radialGradient>
                    </defs>

                    {/* 中心发光底纹 */}
                    <circle cx="320" cy="150" r="95" fill="url(#centerGlow)" />

                    {/* 跨主题节点共享来源连线 */}
                    {interLinks.map((link, idx) => {
                      const isHighlighted =
                        hoveredNodeId === link.fromId ||
                        hoveredNodeId === link.toId ||
                        selected?.id === link.fromId ||
                        selected?.id === link.toId;
                      return (
                        <path
                          key={`inter-${idx}`}
                          d={`M${link.x1} ${link.y1} Q320 150 ${link.x2} ${link.y2}`}
                          fill="none"
                          stroke={isHighlighted ? '#38BDF8' : '#334155'}
                          strokeWidth={isHighlighted ? 1.5 : 0.75}
                          strokeDasharray={isHighlighted ? 'none' : '3,3'}
                          opacity={isHighlighted ? 0.9 : 0.4}
                          className="transition-all duration-300"
                        />
                      );
                    })}

                    {/* 中心发射线与节点 */}
                    {nodes.map((n) => {
                      const pos = nodePositions.get(n.id) || { x: 320, y: 150 };
                      const { x, y } = pos;
                      const isHovered = hoveredNodeId === n.id;
                      const strokeColor = n.active
                        ? '#38BDF8'
                        : isHovered
                        ? '#60A5FA'
                        : '#475569';
                      const strokeW = n.active ? 2 : isHovered ? 1.5 : 1;

                      return (
                        <g key={n.id}>
                          <path
                            d={`M320 150 Q${320 + (x - 320) * 0.35} ${y} ${x} ${y}`}
                            fill="none"
                            stroke={strokeColor}
                            strokeWidth={strokeW}
                            opacity={n.active || isHovered ? 0.9 : 0.5}
                            className="transition-all duration-200"
                          />
                          <g
                            role="button"
                            tabIndex={0}
                            aria-label={`${n.scope} ${n.name}，${n.subtitle}`}
                            aria-pressed={n.active}
                            onClick={n.action}
                            onMouseEnter={() => setHoveredNodeId(n.id)}
                            onMouseLeave={() => setHoveredNodeId(null)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                n.action();
                              }
                            }}
                            className="cursor-pointer outline-none transition-transform"
                          >
                            <title>
                              {n.scope} {n.name} · {n.subtitle}
                            </title>
                            <rect
                              x={x - 76}
                              y={y - 23}
                              width="152"
                              height="46"
                              rx="12"
                              fill={n.active ? '#0F172A' : '#1E293B'}
                              stroke={n.active ? '#38BDF8' : isHovered ? '#60A5FA' : '#334155'}
                              strokeWidth={n.active ? 1.8 : 1}
                              className="transition-all duration-200"
                            />
                            <text
                              x={x}
                              y={y - 3}
                              textAnchor="middle"
                              fill={n.active ? '#38BDF8' : '#F1F5F9'}
                              fontSize="12"
                              fontWeight={n.active ? '600' : '500'}
                            >
                              {n.name.length > 11 ? n.name.slice(0, 11) + '…' : n.name}
                            </text>
                            <text
                              x={x}
                              y={y + 13}
                              textAnchor="middle"
                              fill={n.active ? '#93C5FD' : '#94A3B8'}
                              fontSize="10"
                            >
                              {n.subtitle}
                            </text>
                          </g>
                        </g>
                      );
                    })}

                    {/* 中心天体：已有知识 */}
                    <circle cx="320" cy="150" r="42" fill="#0F172A" stroke="#38BDF8" strokeWidth="1.5" />
                    <circle cx="320" cy="150" r="37" fill="#1E293B" opacity="0.6" />
                    <text x="320" y="146" textAnchor="middle" fill="#F8FAFC" fontSize="13" fontWeight="600">
                      已有知识
                    </text>
                    <text x="320" y="163" textAnchor="middle" fill="#38BDF8" fontSize="11" fontWeight="500">
                      {data.totals.sources} 个来源
                    </text>
                  </svg>
                ) : (
                  <div className="p-10 text-center text-viaim-textDim">
                    <BookOpen className="mx-auto mb-3 opacity-50" />
                    <p className="text-sm">知识正在这里积累</p>
                    <p className="text-xs mt-2">
                      从左栏上传资料，或录制、导入会议。处理完成后自动汇入全景。
                    </p>
                  </div>
                )}

                <p className="px-4 pb-4 text-[11px] text-viaim-textDim">
                  连线表示主题归入知识库与来源共享，以原文实体为依据。
                  {data.pending > 0 ? ` 还有 ${data.pending} 批事实待整理。` : ''}
                </p>
              </section>
            ) : (
              /* 知识矩阵模式 */
              <section className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-viaim-textDim">点击主题卡片可快速筛选下方关联来源</span>
                  <span className="text-viaim-primary font-medium">{topics.length} 个主题</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {topics.map((t) => {
                    const c = typeColors[t.type] || typeColors.concept;
                    const isActive = topicId === t.id;
                    return (
                      <button
                        key={t.id}
                        onClick={() => setTopicId(isActive ? null : t.id)}
                        className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                          isActive
                            ? 'border-cyan-500 bg-cyan-950/30 ring-1 ring-cyan-500/40 shadow-sm'
                            : 'border-viaim-border bg-slate-900/40 hover:border-slate-700 hover:bg-slate-900/70'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1.5">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] border font-medium ${c.badge}`}>
                            {typeNames[t.type] || t.type}
                          </span>
                          <span className="text-[10px] text-viaim-textDim">
                            {t.sourceIds.length} 来源 · {t.facts} 事实
                          </span>
                        </div>
                        <h3 className="text-xs font-semibold text-viaim-textMain mt-2 truncate">{t.name}</h3>
                        {t.scope && <p className="text-[10px] text-viaim-textDim mt-0.5">{t.scope}</p>}
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {(data.limited || data.unavailable > 0) && (
              <p className="text-xs text-amber-300">
                {data.limited ? '本视图最多展示 500 个来源、300 个主题，统计仅覆盖当前展示范围。' : ''}
                {data.unavailable > 0 ? ` ${data.unavailable} 个来源暂不可读取，未纳入当前视图。` : ''}
              </p>
            )}

            {/* 搜索与主题筛选下拉框（保留测试选择器） */}
            <div className="space-y-2">
              <div className="relative">
                <Search size={15} className="absolute left-3 top-3 text-viaim-textDim" />
                <input
                  aria-label="搜索全景主题或来源"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索主题、项目或来源…"
                  className="w-full bg-slate-900 border border-viaim-border rounded-lg py-2 pl-9 pr-3 text-xs text-viaim-textMain placeholder-viaim-textDim focus:outline-none focus:border-cyan-500"
                />
              </div>

              {data.topics.length > 0 && (
                <label className="flex gap-2 items-center text-xs text-viaim-textDim">
                  主题
                  <select
                    aria-label="筛选知识主题"
                    value={topicId || ''}
                    onChange={(e) => setTopicId(e.target.value || null)}
                    className="min-w-0 flex-1 bg-slate-800 rounded p-2 text-viaim-textMain border border-slate-700 focus:outline-none focus:border-cyan-500 text-xs"
                  >
                    <option value="">全部主题</option>
                    {data.topics.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.scope ? `${t.scope} · ` : ''}
                        {t.name}（{t.sourceIds.length} 个来源）
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            {/* 来源卡片列表 */}
            <section className="space-y-2.5">
              <h2 className="text-sm font-semibold flex items-center justify-between">
                <span>{selected ? `${selected.scope ? `${selected.scope} · ` : ''}${selected.name} · 相关来源` : '全部知识来源'}</span>
                <span className="text-viaim-textDim font-normal text-xs">{sources.length} 个</span>
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                {sources.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => openSource(s)}
                    className="w-full text-left p-3.5 rounded-xl border border-viaim-border hover:border-cyan-500/60 bg-slate-900/40 hover:bg-slate-900/70 flex gap-3 transition-all cursor-pointer group"
                  >
                    <div className="p-2 rounded-lg bg-slate-800/80 border border-slate-700/50 self-start shrink-0">
                      {s.type === 'document' ? (
                        <FileText className="text-cyan-300 group-hover:text-cyan-200" size={18} />
                      ) : (
                        <Mic className="text-indigo-300 group-hover:text-indigo-200" size={18} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-xs font-semibold text-viaim-textMain group-hover:text-cyan-300 break-words transition-colors">
                        {s.title}
                      </h3>
                      <p className="text-[11px] text-viaim-textDim mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-slate-400">
                          {s.type === 'document' ? `${s.knowledgeUnits} 条知识` : '会议记忆'}
                        </span>
                        <span>· {s.facts} 条提取事实</span>
                        <span>· {s.date ? s.date.slice(0, 8) : '日期未知'}</span>
                      </p>
                    </div>
                  </button>
                ))}
              </div>

              {!sources.length && data.totals.sources > 0 && (
                <p className="text-xs text-viaim-textDim py-4 text-center">
                  没有匹配的来源，试试其他关键词或选择全部主题。
                </p>
              )}
            </section>

            {/* 自动跟进与变化 */}
            {!!insights && (insights.followups.length > 0 || insights.changes.length > 0) && (
              <section className="border-t border-viaim-border pt-4 space-y-3">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  <CheckCircle2 size={15} className="text-cyan-300" />
                  自动跟进与变化
                </h2>

                <div className="space-y-2">
                  {insights.followups.map((t) => (
                    <details key={t.id} className="p-3 rounded-xl border border-viaim-border bg-slate-900/40 text-xs">
                      <summary className="cursor-pointer text-viaim-textMain font-medium flex items-center justify-between">
                        <span>{t.scope} · {t.project} · {t.item}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] ${
                          t.status === 'completed' || t.status === 'resolved'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : t.status === 'cancelled'
                            ? 'bg-slate-800 text-slate-400'
                            : 'bg-amber-500/15 text-amber-300'
                        }`}>
                          {({
                            open: '待跟进',
                            completed: '有完成证据',
                            resolved: '有答复证据',
                            cancelled: '已取消',
                            conflict: '有冲突',
                            uncertain: '依据不完整'
                          } as Record<string, string>)[t.status] || t.status}
                        </span>
                      </summary>
                      <p className="mt-2 text-viaim-textDim text-[11px]">
                        责任人 {t.owners.join('、') || '未明确'} · {t.dueDate || '期限未明确'}
                        {t.overdue ? ' · 已过期限，尚无完成证据' : ''}
                      </p>
                      {t.history.map((h) => (
                        <p key={h.id} className="mt-2.5 text-slate-300 leading-relaxed bg-slate-950/40 p-2 rounded">
                          {h.quote}{' '}
                          <button
                            className="text-cyan-300 hover:underline inline-flex items-center gap-0.5 ml-1 cursor-pointer"
                            onClick={() => {
                              const c = insights.citations.find((c) => c.chunkId === h.chunkId);
                              if (c) void onOpenMemory(c).catch((e) => setError(e.message));
                            }}
                          >
                            <ExternalLink size={11} /> 核对来源
                          </button>
                        </p>
                      ))}
                    </details>
                  ))}

                  {insights.changes.map((c, i) => (
                    <details key={i} className="p-3 rounded-xl border border-viaim-border bg-slate-900/40 text-xs">
                      <summary className="cursor-pointer text-viaim-amber font-medium flex items-center justify-between">
                        <span>{c.scope} · {c.project} · {c.aspect}</span>
                        <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/15 text-amber-300">
                          {c.status === 'conflict' ? '待核实冲突' : '有明确变更'}
                        </span>
                      </summary>
                      {c.history.map((h) => (
                        <p key={h.id} className="mt-2.5 text-slate-300 leading-relaxed bg-slate-950/40 p-2 rounded">
                          {h.quote}{' '}
                          <button
                            className="text-cyan-300 hover:underline inline-flex items-center gap-0.5 ml-1 cursor-pointer"
                            onClick={() => {
                              const source = insights.citations.find((s) => s.chunkId === h.chunkId);
                              if (source) void onOpenMemory(source).catch((e) => setError(e.message));
                            }}
                          >
                            <ExternalLink size={11} /> 核对依据
                          </button>
                        </p>
                      ))}
                    </details>
                  ))}
                </div>
              </section>
            )}

            {/* 尚未入库资料 */}
            {pendingDocs.length > 0 && (
              <section className="border-t border-viaim-border pt-4 space-y-2">
                <h2 className="text-sm font-semibold flex items-center gap-1.5 text-slate-400">
                  <AlertTriangle size={14} className="text-amber-400" />
                  尚未进入记忆 · {pendingDocs.length}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {pendingDocs.map((d) => (
                    <button
                      key={d.id}
                      onClick={() => onSelect(d.id)}
                      className="block text-left w-full text-xs p-3 rounded-lg bg-slate-900/50 hover:bg-slate-900 border border-slate-800 text-viaim-textDim transition-colors"
                    >
                      <span className="text-viaim-textMain font-medium break-words block mb-1">
                        {d.name}
                      </span>
                      <span>
                        {d.error
                          ? '处理待重试'
                          : d.status === 'queued'
                          ? '等待处理'
                          : d.status === 'interpreting'
                          ? '逐页解读中'
                          : '整理知识中'}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </>
  );
}
