// Rebuildable, deterministic interpretation of evidence-bound assertions.
import { createHash } from 'node:crypto';
const digest = (s) => createHash('sha256').update(s).digest('hex').slice(0, 24);
export const normalize = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
const clean = (s, max = 120) => typeof s === 'string' && s.trim().length <= max ? s.trim() : '';
const tentative = /建议|可能|考虑|尚未|未批准|未决定|不要|不改|不调整|如果|假如|暂不/;
const changeMarker = /改为|改到|调整为|调整到|变更为|变更到|推迟到|提前到|替换为|由.{1,40}变为/;
const properties = { deadline: /交付|截止|期限|日期|时间/, owner: /负责|责任人|负责人/, budget: /预算|经费|成本/, status: /状态|进度|完成|暂停|启动|取消/, requirement: /要求|需求|规格|标准/ };
const digits = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function number(s) {
  if (/^\d+$/.test(s)) return Number(s);
  if (s.includes('十')) { const [a, b] = s.split('十'); return (a ? digits[a] : 1) * 10 + (b ? digits[b] : 0); }
  return digits[s];
}
function date(y, m, d) {
  const value = new Date(Date.UTC(y, m - 1, d));
  if (value.getUTCFullYear() !== y || value.getUTCMonth() + 1 !== m || value.getUTCDate() !== d) return null;
  return value.toISOString().slice(0, 10);
}
export function resolveDate(text, observedAt) {
  const value = normalize(text);
  let m = /^(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})(?:日|号)?$/.exec(value);
  if (m) return date(+m[1], +m[2], +m[3]);
  const time = Date.parse(observedAt);
  if (!Number.isFinite(time)) return null;
  const local = new Date(time + 8 * 3600000);
  const year = local.getUTCFullYear(), month = local.getUTCMonth() + 1;
  m = /^(本月|这个月|下月|下个月)([\d一二三四五六七八九十两]+)(?:日|号)$/.exec(value);
  if (m) {
    const next = m[1]?.startsWith('下');
    const target = new Date(Date.UTC(year, month - 1 + (next ? 1 : 0), 1));
    return date(target.getUTCFullYear(), target.getUTCMonth() + 1, number(m[2]));
  }
  if (/^(月底|本月底|下月底|下个月底)$/.test(value)) {
    return new Date(Date.UTC(year, month + (value.startsWith('下') ? 1 : 0), 0)).toISOString().slice(0, 10);
  }
  return null; // Unsupported relative expressions remain explicit uncertainty.
}

function canonicalValue(value, property, observedAt) {
  if (property === 'deadline') return resolveDate(value, observedAt) || normalize(value);
  if (property === 'budget') {
    const match = /^([\d.]+|[一二两三四五六七八九十]+)(万)?元(?:人民币)?$/.exec(value);
    if (match) {
      const amount = /^[\d.]+$/.test(match[1]) ? Number(match[1]) : number(match[1]);
      if (Number.isFinite(amount)) return `CNY:${amount * (match[2] ? 10000 : 1)}`;
    }
  }
  return normalize(value);
}

// The model proposes a structure; it cannot choose an existing entity or fact ID.
export function validateStructure(fact, chunk, observedAt) {
  const raw = fact.structure;
  if (!raw || typeof raw !== 'object') return null;
  const entity = raw.entity || {};
  const name = clean(entity.name), scope = clean(entity.scope), code = clean(entity.code, 60);
  const aspect = clean(raw.aspect), property = clean(raw.property), value = clean(raw.value, 200);
  const quote = String(fact.quote || '');
  // All identity and slot fields must be present in this fact's bound evidence.
  if (!name || !aspect || !value || /^(不变|同上|原计划|待定|另行通知)$/.test(value) || !properties[property] || !properties[property].test(quote)) return null;
  if (![name, aspect, value, ...(scope ? [scope] : [])].every((s) => quote.includes(s))) return null;
  const validCode = code && /^[a-zA-Z0-9][a-zA-Z0-9_-]{2,59}$/.test(code)
    && quote.includes(code) && /项目编号|项目编码|项目代号/.test(quote) ? code : '';
  const aliases = Array.isArray(entity.aliases) && /简称|又称|别名/.test(quote)
    ? entity.aliases.map((s) => clean(s)).filter((s) => s.length >= 2 && quote.includes(s) && s !== name).slice(0, 5) : [];
  const previousValue = clean(raw.previousValue, 200);
  const proposed = fact.kind === 'proposal' || tentative.test(quote);
  const operation = !proposed && raw.operation === 'replace' && (!previousValue || quote.includes(previousValue))
    && changeMarker.test(quote) ? 'replace' : 'assert';
  const effectiveText = clean(raw.effectiveFrom, 50);
  const effectiveDate = effectiveText && quote.includes(effectiveText) && /生效|起执行|起实行/.test(quote)
    ? resolveDate(effectiveText, observedAt) : null;
  return { entity: { name, scope, code: validCode, aliases }, aspect, property, value,
    normalizedValue: canonicalValue(value, property, observedAt),
    previousValue: operation === 'replace' ? previousValue : '',
    normalizedPrevious: operation === 'replace' ? canonicalValue(previousValue, property, observedAt) : '',
    operation, proposed, effectiveText, effectiveDate,
    temporalUncertain: Boolean(effectiveText && !effectiveDate),
    dateUncertain: property === 'deadline' && !resolveDate(value, observedAt),
    linked: Boolean(scope && (validCode || name.length >= 3)) };
}

export function buildProjectMemory(facts, now = Date.now()) {
  const rows = facts.filter((f) => f.structure);
  const parent = rows.map((_, i) => i);
  const groupCodes = new Map(rows.map((f, i) => [i, new Set(f.structure.entity.code ? [normalize(f.structure.entity.code)] : [])]));
  const root = (i) => { while (parent[i] !== i) i = parent[i]; return i; };
  const union = (a, b) => {
    const left = root(a), right = root(b);
    if (left === right) return;
    parent[right] = left;
    for (const code of groupCodes.get(right)) groupCodes.get(left).add(code);
  };
  const keys = new Map();
  const ambiguous = new Set();
  rows.forEach((f, i) => {
    const s = f.structure, e = s.entity;
    if (!s.linked) return;
    for (const name of [e.name, ...e.aliases]) {
      const key = `${normalize(e.scope)}:${normalize(name)}`;
      if (!keys.has(key)) keys.set(key, []);
      keys.get(key).push(i);
    }
  });
  // Code identity within an organisation is stronger than spelling or aliases.
  const codes = new Map();
  rows.forEach((f, i) => {
    const e = f.structure.entity;
    if (!f.structure.linked || !e.code) return;
    const key = `${normalize(e.scope)}:${normalize(e.code)}`;
    if (codes.has(key)) union(codes.get(key), i); else codes.set(key, i);
  });
  for (const indices of keys.values()) {
    const distinct = new Set(indices.flatMap((i) => [...groupCodes.get(root(i))]));
    if (distinct.size > 1) { indices.forEach((i) => ambiguous.add(i)); continue; }
    indices.slice(1).forEach((i) => union(indices[0], i));
  }
  const entities = new Map();
  rows.forEach((fact, i) => {
    const s = fact.structure, e = s.entity;
    const key = s.linked ? String(root(i)) : `local:${fact.source_id}:${normalize(e.scope)}:${normalize(e.name)}`;
    if (!entities.has(key)) entities.set(key, { name: e.name, scope: e.scope, code: e.code,
      aliases: new Set(), linked: s.linked, ambiguous: false, facts: [] });
    const entity = entities.get(key);
    entity.aliases.add(e.name); e.aliases.forEach((a) => entity.aliases.add(a));
    entity.ambiguous ||= ambiguous.has(i); entity.code ||= e.code;
    entity.facts.push(fact);
  });
  return [...entities.values()].map((entity) => {
    const slots = new Map();
    for (const fact of entity.facts) {
      const s = fact.structure, key = `${normalize(s.aspect)}:${s.property}`;
      if (!slots.has(key)) slots.set(key, { aspect: s.aspect, property: s.property, facts: [] });
      slots.get(key).facts.push(fact);
    }
    const states = [...slots.values()].map((slot) => {
      const ordered = slot.facts.map((f) => {
        const s = f.structure, observed = Date.parse(f.occurred_at);
        const effective = s.effectiveDate ? Date.parse(`${s.effectiveDate}T00:00:00+08:00`) : observed;
        return { ...f, observed, effective, status: s.proposed ? 'proposed' : (!Number.isFinite(observed) || s.temporalUncertain ? 'uncertain' : observed > now || effective > now ? 'scheduled' : 'current') };
      }).sort((a, b) => a.effective - b.effective || a.observed - b.observed || a.id.localeCompare(b.id));
      const links = [];
      for (const next of ordered) {
        const s = next.structure;
        if (next.status !== 'current' || s.operation !== 'replace' || s.dateUncertain) continue;
        const candidates = ordered.filter((old) => ['current', 'scheduled'].includes(old.status) && old.observed < next.observed
          && !old.structure.dateUncertain);
        // Explicit change without repeating the old value is safe only if the previous slot is unambiguous.
        const unique = new Set(candidates.map((old) => old.structure.normalizedValue));
        if (!s.previousValue && unique.size !== 1) continue;
        for (const old of candidates) {
          if (s.previousValue && old.structure.normalizedValue !== s.normalizedPrevious) continue;
          old.status = 'superseded'; old.supersededBy = next.id;
          links.push({ from: old.id, to: next.id, evidenceFactId: next.id, effectiveAt: new Date(next.effective).toISOString() });
        }
      }
      const current = ordered.filter((f) => f.status === 'current');
      // Separate requirements may coexist; different deadlines/owners/budgets need reconciliation.
      const conflict = slot.property !== 'requirement' && new Set(current.map((f) => f.structure.normalizedValue)).size > 1;
      return { aspect: slot.aspect, property: slot.property, status: conflict ? 'conflict' : current.length ? 'current' : 'uncertain',
        currentFactIds: current.map((f) => f.id), links,
        history: ordered.map((f) => ({ id: f.id, sourceId: f.source_id, chunkId: f.chunk_id, version: f.version,
          value: f.structure.value, normalizedValue: f.structure.normalizedValue, claim: f.claim, quote: f.quote,
          status: f.status, supersededBy: f.supersededBy || null, observedAt: f.occurred_at,
          effectiveAt: Number.isFinite(f.effective) ? new Date(f.effective).toISOString() : null,
          recordedAt: new Date(f.created_at).toISOString(), dateUncertain: f.structure.dateUncertain })) };
    });
    const names = [...entity.aliases].sort();
    return { id: digest(`${entity.scope}:${entity.code || names.join('|')}:${entity.linked ? '' : entity.facts[0].source_id}`),
      name: entity.name, scope: entity.scope, code: entity.code, aliases: names, linked: entity.linked,
      ambiguous: entity.ambiguous, states };
  });
}
