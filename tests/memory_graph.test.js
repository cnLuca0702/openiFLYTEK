import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../server/memory_store.js';
import { MemoryService } from '../server/memory_service.js';
import { resolveDate, validateStructure, buildProjectMemory } from '../server/memory_graph.js';
const NOW = Date.parse('2026-10-28T12:00:00+08:00');
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-graph-'));
  const store = new MemoryStore(path.join(dir, 'db'));
  const meetings = new Map();
  const service = new MemoryService({ store, now: () => NOW, getMeeting: (id) => meetings.get(id), listGroups: [{ list: () => [...meetings.values()], owns: () => true }] });
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  function add(id, day, value, extra = {}) {
    const { name = '晨星项目', scope = '甲公司', previousValue = '', effectiveFrom = '', aliases = [], code = '', kind = previousValue ? 'change' : 'decision', operation = previousValue ? 'replace' : 'assert', aspect = '首版', quote: customQuote } = extra;
    const quote = customQuote || `${scope}${name}${code ? `（项目编号${code}）` : ''}${aliases.length ? `，简称${aliases.join('、')}` : ''}的${aspect}交付日期${previousValue ? `从${previousValue}改为` : '确定为'}${value}${effectiveFrom ? `，${effectiveFrom}生效` : ''}。`;
    const meeting = { id, title: `${name}会议`, createdAt: `2026-10-${day}T10:00:00+08:00`, sentences: [{ id: 's1', text: quote, startTimeMs: 1000 }] };
    meetings.set(id, meeting); store.upsert(meeting);
    const job = store.nextJob();
    assert.equal(job.source_id, id);
    store.finishJob(job, [{ chunkId: job.chunks[0].id, kind, subject: name, claim: quote, quote,
      structure: { entity: { name, scope, code, aliases }, aspect, property: 'deadline', value, previousValue, operation, effectiveFrom } }]);
    return meeting;
  }
  return { store, service, meetings, add, graph: (now = NOW) => store.projectMemory({ now }) };
}
const state = (g) => g[0].states[0];

test('cross-meeting explicit changes form a chain independent of ingestion order', (t) => {
  const { add, graph } = setup(t);
  add('c', '25', '下月二十号', { previousValue: '下月十号' });
  add('a', '15', '月底');
  add('b', '20', '下月十号', { previousValue: '月底' });
  const s = state(graph());
  assert.equal(s.status, 'current'); assert.equal(s.links.length, 2);
  assert.deepEqual(s.history.map((f) => f.status), ['superseded', 'superseded', 'current']);
  assert.equal(s.history.at(-1).normalizedValue, '2026-11-20');
  assert.equal(s.history[0].supersededBy, s.history[1].id);
});

test('newer assertions conflict instead of overwriting; proposals do not become current', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底'); add('b', '20', '下月十号');
  add('c', '25', '下月二十号', { previousValue: '下月十号', kind: 'proposal' });
  const s = state(graph());
  assert.equal(s.status, 'conflict'); assert.equal(s.currentFactIds.length, 2); assert.equal(s.links.length, 0);
  assert.equal(s.history.at(-1).status, 'proposed');
});

test('negated or conditional changes cannot supersede confirmed facts', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底');
  add('b', '20', '下月十号', { previousValue: '月底', quote: '甲公司晨星项目的首版交付日期，尚未决定从月底改为下月十号。' });
  const s = state(graph()); assert.equal(s.links.length, 0); assert.equal(s.history[1].status, 'proposed');
});

test('same project names in different organisations and stages stay separate', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底'); add('b', '20', '下月十号', { scope: '乙公司', previousValue: '月底' });
  add('c', '25', '下月二十号', { aspect: '二期' });
  assert.equal(graph().length, 2);
  assert.equal(graph().find((e) => e.scope === '甲公司').states.length, 2);
  assert.ok(graph().every((e) => e.states.every((s) => s.links.length === 0)));
});

test('explicit aliases link across meetings; ambiguous codes do not collapse', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底', { aliases: ['星计划'] });
  add('b', '20', '下月十号', { name: '星计划', previousValue: '月底' });
  assert.equal(graph().length, 1); assert.equal(state(graph()).links.length, 1);
  add('c', '25', '下月二十号', { code: 'PRJ-A' });
  add('d', '26', '下月二十号', { code: 'PRJ-B' });
  const coded = graph().filter((e) => e.code);
  assert.equal(coded.length, 2); assert.ok(coded.every((e) => e.ambiguous));
});

test('missing scope remains source-local and fabricated identity is rejected', (t) => {
  const { add, graph, store } = setup(t);
  add('a', '15', '月底', { scope: '' }); add('b', '20', '下月十号', { scope: '' });
  assert.equal(graph().length, 2); assert.ok(graph().every((e) => !e.linked));
  add('c', '25', '月底', { scope: '虚构公司', quote: '晨星项目的首版交付日期确定为月底。' });
  assert.equal(graph().length, 2); assert.equal(store.status().facts, 3);
});

test('future effective dates preserve the old state until effective, not due date', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底');
  add('b', '20', '下月十号', { previousValue: '月底', effectiveFrom: '2026年11月1日' });
  const before = state(graph());
  assert.equal(before.history.find((f) => f.sourceId === 'a').status, 'current');
  assert.equal(before.history.find((f) => f.sourceId === 'b').status, 'scheduled');
  const after = state(graph(Date.parse('2026-11-02T00:00:00+08:00')));
  assert.equal(after.links.length, 1); assert.equal(after.history.at(-1).status, 'current');
});

test('source deletion or correction recomputes current state without dangling replacement links', (t) => {
  const { add, graph, store, meetings } = setup(t);
  add('a', '15', '月底'); add('b', '20', '下月十号', { previousValue: '月底' });
  store.remove('b'); meetings.delete('b');
  assert.equal(state(graph()).history.length, 1); assert.equal(state(graph()).history[0].status, 'current');
  add('c', '25', '下月二十号', { previousValue: '月底' });
  store.upsert({ ...meetings.get('c'), sentences: [{ id: 's1', text: '会议内容已经纠正，无此决定。' }] });
  assert.equal(state(graph()).links.length, 0); assert.equal(state(graph()).history[0].status, 'current');
});

test('relative dates resolve against meeting time, reject impossible dates and unknown expressions', () => {
  assert.equal(resolveDate('下月十号', '2026-12-20T00:00:00+08:00'), '2027-01-10');
  assert.equal(resolveDate('月底', '2024-02-01T00:00:00+08:00'), '2024-02-29');
  assert.equal(resolveDate('2026年2月30日', '2026-02-01'), null);
  assert.equal(resolveDate('春节以后', '2026-02-01'), null);
  assert.equal(resolveDate('下月十号', ''), null);
});

test('answer expands beyond a matching passage to include the whole replacement chain', async (t) => {
  const { add, service } = setup(t);
  add('a', '15', '月底'); add('b', '20', '下月十号', { previousValue: '月底' });
  service.ask = async ({ user }) => {
    const input = JSON.parse(user);
    assert.equal(input.projects.length, 1); assert.equal(input.projects[0].states[0].links.length, 1);
    const refs = input.projects[0].states[0].history.map((f) => f.ref);
    return { content: JSON.stringify({ answer: `交付日期已调整。[${refs[0]}][${refs[1]}]`, citations: refs }), model: 'fixture' };
  };
  const result = await service.answer({ question: '晨星项目什么时候交付' });
  assert.equal(result.projects[0].states[0].links.length, 1); assert.equal(result.citations.length, 2);
});

test('explicit meeting scope cannot inherit later decisions outside scope', async (t) => {
  const { add, service } = setup(t);
  add('a', '15', '月底'); add('b', '20', '下月十号', { previousValue: '月底' });
  service.ask = async ({ user }) => {
    const input = JSON.parse(user); assert.ok(input.sources.every((c) => c.meetingId === 'a'));
    assert.equal(input.projects[0].states[0].links.length, 0);
    return { content: '{"answer":"所选会议中为月底。[1]","citations":[1]}' };
  };
  await service.answer({ question: '晨星项目交付日期', meetingIds: ['a'] });
});

test('an explicit change can replace an unambiguous prior value without repeating it', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底');
  add('b', '20', '下月十号', { kind: 'change', operation: 'replace', quote: '甲公司晨星项目的首版交付日期推迟到下月十号。' });
  assert.equal(state(graph()).links.length, 1);
});

test('unknown effective dates never silently become current and unchanged references are not values', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底');
  add('b', '20', '下月十号', { previousValue: '月底', effectiveFrom: '春节以后' });
  add('c', '25', '不变');
  assert.equal(state(graph()).links.length, 0);
  assert.equal(state(graph()).history.find((f) => f.sourceId === 'b').status, 'uncertain');
  assert.equal(state(graph()).history.length, 2);
});

test('structured facts and graph survive restart, and v1 jobs backfill only once', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-v2-migration-'));
  const filename = path.join(dir, 'db');
  let store = new MemoryStore(filename);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  store.upsert({ id: 'a', title: '晨星项目', createdAt: '2026-10-15', sentences: [{ text: '甲公司晨星项目的首版交付日期确定为月底。' }] });
  let job = store.nextJob(); store.finishJob(job, []);
  store.db.prepare("DELETE FROM memory_meta WHERE key='extractor_version'").run();
  store.db.exec('ALTER TABLE memory_facts DROP COLUMN structure_json');
  store.close(); store = new MemoryStore(filename);
  job = store.nextJob(); assert.ok(job);
  store.finishJob(job, [{ chunkId: job.chunks[0].id, kind: 'decision', subject: '晨星项目', claim: '月底交付', quote: job.chunks[0].text,
    structure: { entity: { name: '晨星项目', scope: '甲公司' }, aspect: '首版', property: 'deadline', value: '月底' } }]);
  const before = store.projectMemory({ now: NOW });
  store.close(); store = new MemoryStore(filename);
  assert.equal(store.nextJob(), null);
  assert.deepEqual(store.projectMemory({ now: NOW }), before);
  assert.equal(before.length, 1);
});

test('background extraction itself validates and persists v2 structure without user actions', async (t) => {
  const { store, service, meetings } = setup(t);
  const text = '甲公司晨星项目的首版交付日期确定为月底。';
  meetings.set('a', { id: 'a', title: '晨星项目', createdAt: '2026-10-15', sentences: [{ text }] });
  service.ask = async ({ user }) => {
    const input = JSON.parse(user);
    return { content: JSON.stringify({ facts: [{ kind: 'decision', subject: '晨星项目', claim: '月底交付', quote: text, chunkId: input.chunks[0].chunkId,
      structure: { entity: { name: '晨星项目', scope: '甲公司' }, aspect: '首版', property: 'deadline', value: '月底' } }] }) };
  };
  await service.tick();
  assert.equal(store.status().pending, 0);
  assert.equal(store.projectMemory({ now: NOW })[0].states[0].history[0].normalizedValue, '2026-10-31');
});

test('change without prior value does not arbitrarily settle an existing conflict', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底'); add('b', '20', '下月十号');
  add('c', '25', '下月二十号', { kind: 'change', operation: 'replace', quote: '甲公司晨星项目的首版交付日期推迟到下月二十号。' });
  assert.equal(state(graph()).links.length, 0);
  assert.equal(state(graph()).status, 'conflict');
  assert.equal(state(graph()).currentFactIds.length, 3);
});

test('unavailable evidence suppresses complete-state claims rather than silently reviving an old decision', async (t) => {
  const { add, service, meetings } = setup(t);
  add('a', '15', '月底'); add('b', '20', '下月十号', { previousValue: '月底' });
  service.getMeeting = (id) => { if (id === 'b') throw new Error('source offline'); return meetings.get(id); };
  const hits = await service.recall('晨星项目');
  const context = service.projectContext('晨星项目', hits);
  assert.equal(context.entities.length, 0);
  assert.ok(context.warnings.some((w) => w.includes('不可读取')));
});

test('equivalent Chinese amounts agree; independent requirements accumulate', () => {
  function fact(id, property, value, quote) {
    return { id, source_id: id, chunk_id: Number(id), version: 'v1', created_at: NOW, occurred_at: '2026-10-15T10:00:00+08:00', quote,
      structure: validateStructure({ kind: 'fact', quote, structure: { entity: { scope: '甲公司', name: '晨星项目' }, aspect: '首版', property, value } }, { text: quote }, '2026-10-15') };
  }
  const money = [fact('1', 'budget', '八万元', '甲公司晨星项目的首版预算八万元。'), fact('2', 'budget', '80000元', '甲公司晨星项目的首版预算80000元。')];
  assert.equal(state(buildProjectMemory(money, NOW)).status, 'current');
  const requirements = [fact('3', 'requirement', '测试报告', '甲公司晨星项目的首版要求提交测试报告。'), fact('4', 'requirement', '说明文档', '甲公司晨星项目的首版要求提交说明文档。')];
  assert.equal(state(buildProjectMemory(requirements, NOW)).status, 'current');
  assert.equal(state(buildProjectMemory(requirements, NOW)).currentFactIds.length, 2);
});

test('a later explicit revision can cancel a previously scheduled change before it takes effect', (t) => {
  const { add, graph } = setup(t);
  add('a', '15', '月底');
  add('b', '20', '下月十号', { previousValue: '月底', effectiveFrom: '2026年11月1日' });
  add('c', '25', '下月二十号', { previousValue: '下月十号' });
  const s = state(graph());
  assert.equal(s.history.find((f) => f.sourceId === 'b').status, 'superseded');
  // c explicitly replaces b, not a: differing active assertions remain visible, not guessed away.
  assert.equal(s.status, 'conflict');
  assert.equal(state(graph(Date.parse('2026-11-02'))).history.find((f) => f.sourceId === 'b').status, 'superseded');
});
