import { useState } from 'react';
import type { MemoryCitation, MemoryProject } from '../services/api';

const properties: Record<string, string> = { deadline: '交付/截止时间', owner: '负责人', budget: '预算', status: '状态', requirement: '要求' };
const labels = { current: '当前断言', superseded: '已被替代', proposed: '建议/待定', scheduled: '尚未生效', uncertain: '时间依据不足' };
const time = (value: string | null) => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN') : '未知';

export function MemoryState({ projects, warnings, citations, onOpen }: {
  projects: MemoryProject[];
  warnings: string[];
  citations: MemoryCitation[];
  onOpen: (citation: MemoryCitation) => Promise<void>;
}) {
  const [error, setError] = useState('');
  if (!projects.length && !warnings.length) return null;
  return <div className="mt-3 space-y-2 whitespace-normal text-[11px]">
    {warnings.map((warning) => <p key={warning} className="text-amber-300">{warning}</p>)}
    {projects.map((project) => <details key={project.id} className="rounded-lg border border-viaim-border p-2">
      <summary className="cursor-pointer text-cyan-200">{project.scope} · {project.name}{project.code ? ` (${project.code})` : ''}：事实状态与变更</summary>
      <p className="mt-1 text-viaim-textDim">回答时、当前查询范围内的状态。{!project.linked && '身份依据不足，仅保留单场会议记录。'}{project.ambiguous && '存在同名项目，已保守区分。'}</p>
      {project.states.map((state) => <div key={`${state.aspect}:${state.property}`} className="mt-2 border-t border-viaim-border pt-2">
        <p className={state.status === 'conflict' ? 'text-amber-300' : 'text-slate-200'}>
          {state.aspect} · {properties[state.property] || state.property}：{state.status === 'conflict' ? '存在冲突，尚无唯一结论' : state.status === 'uncertain' ? '尚无确定当前状态' : '当前有据记录'}
        </p>
        {state.history.map((fact) => <div key={fact.id} className="mt-2 pl-2 border-l border-viaim-border">
          <p>{fact.value} · {labels[fact.status]}{fact.dateUncertain ? '（日期含义待确定）' : ''}</p>
          {!fact.dateUncertain && fact.normalizedValue !== fact.value && state.property === 'deadline' && <p className="text-viaim-textDim">按会议日期解析：{fact.normalizedValue}</p>}
          <p className="text-viaim-textDim">会议：{time(fact.observedAt)}{fact.effectiveAt && ` · 生效：${time(fact.effectiveAt)}`}</p>
          {fact.supersededBy && <p className="text-viaim-textDim">替代为：{state.history.find((next) => next.id === fact.supersededBy)?.value || '后续记录'}</p>}
          <p className="select-text whitespace-pre-wrap mt-1">“{fact.quote}”</p>
          <button className="text-cyan-300 hover:text-white cursor-pointer" onClick={async () => {
            const citation = citations.find((c) => c.chunkId === fact.chunkId);
            if (!citation) { setError('本次回答未附完整来源，请重新提问'); return; }
            try { setError(''); await onOpen(citation); }
            catch (err) { setError(err instanceof Error ? err.message : '来源暂不可读取'); }
          }}>查看来源 [{fact.ref}]</button>
        </div>)}
      </div>)}
    </details>)}
    {error && <p className="text-amber-300">{error}</p>}
  </div>;
}
