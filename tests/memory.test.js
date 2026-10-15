import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore, tokens } from '../server/memory_store.js';
import { MemoryService } from '../server/memory_service.js';

function fixture(t, ask = async () => ({ content: '{"facts":[]}', model: 'test' })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viaim-memory-test-'));
  const store = new MemoryStore(path.join(dir, 'test.db'));
  const meetings = new Map();
  const service = new MemoryService({ store, getMeeting: (id) => meetings.get(id),
    listGroups: [{ list: () => [...meetings.values()], owns: () => true }], ask });
  t.after(() => { service.stop(); store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, meetings, service };
}
function meeting(id, text, extra = {}) {
  return { id, title: `项目会议 ${id}`, createdAt: '2026-10-15T08:00:00Z',
    sentences: [{ id: 's1', speaker: '张老师', text, startTimeMs: 32000, endTimeMs: 45000 }], ...extra };
}

test('Chinese names and exact model numbers survive tokenization and retrieval', (t) => {
  const { store } = fixture(t);
  store.upsert(meeting('local:a', '科研合作项目由张老师负责，设备型号ZX731，计划月底交付。'));
  assert.ok(tokens('科研合作项目什么时候交付').length);
  assert.equal(store.search('科研合作项目什么时候交付')[0].meetingId, 'local:a');
  assert.equal(store.search('ZX731')[0].startMs, 32000);
  assert.equal(store.search('张老师')[0].sentenceIds[0], 's1');
  assert.equal(store.search('不存在的火星飞船').length, 0);
});

test('full middle of a long meeting is searchable and explicit scope is isolated', (t) => {
  const { store } = fixture(t);
  const sentences = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, text: i === 250 ? '唯一密封圈编号QX9842' : '常规讨论。'.repeat(12), startTimeMs: i * 1000 }));
  store.upsert(meeting('a', '', { sentences }));
  store.upsert(meeting('b', '另一个项目'));
  const hit = store.search('QX9842')[0];
  assert.ok(hit.excerpt.includes('QX9842'));
  assert.ok(hit.sentenceIds.includes('s250'));
  assert.equal(store.search('QX9842', { meetingIds: ['b'] }).length, 0);
});

test('updates invalidate citations and old facts; deletion preserves audit but removes recall', (t) => {
  const { store } = fixture(t);
  const m = meeting('a', '项目首版计划月底交付。');
  assert.equal(store.upsert(m), true);
  assert.equal(store.upsert(m), false);
  const old = store.search('月底')[0];
  const job = store.nextJob();
  store.finishJob(job, [{ chunkId: job.chunks[0].id, kind: 'commitment', subject: '项目', claim: '月底交付', quote: '项目首版计划月底交付。' }]);
  assert.equal(store.status().facts, 1);
  store.upsert(meeting('a', '项目首版计划下月十号交付。'));
  assert.equal(store.evidence(old.chunkId), null);
  assert.equal(store.status().facts, 0);
  assert.equal(store.search('月底').length, 0);
  assert.equal(store.search('下月')[0].meetingId, 'a');
  store.remove('a');
  assert.equal(store.search('交付').length, 0);
  assert.ok(store.db.prepare('SELECT count(*) n FROM memory_chunks').get().n >= 2);
});

test('unbound extraction is rejected and stale asynchronous jobs cannot restore old facts', (t) => {
  const { store } = fixture(t);
  store.upsert(meeting('a', '张老师负责科研合作。'));
  const job = store.nextJob();
  store.finishJob(job, [{ chunkId: job.chunks[0].id, kind: 'fact', subject: '张老师', claim: '负责', quote: '虚构的原文引语' }]);
  assert.equal(store.status().facts, 0);
  store.upsert(meeting('a', '李老师负责科研合作。'));
  store.finishJob(job, [{ chunkId: job.chunks[0].id, kind: 'fact', subject: '张老师', claim: '负责', quote: '张老师负责科研合作。' }]);
  assert.equal(store.status().facts, 0);
});

test('automatic sync removes deleted sources but does not treat an unavailable group as deletion', async (t) => {
  const { store, meetings, service } = fixture(t);
  meetings.set('a', meeting('a', '科研合作项目')); await service.sync();
  assert.equal(store.status().sources, 1);
  service.listGroups[0].list = () => { throw new Error('offline'); };
  await service.sync(); assert.equal(store.status().sources, 1);
  service.listGroups[0].list = () => [];
  await service.sync(); assert.equal(store.status().sources, 0);
});

test('background extraction retries without logging evidence and persists progress', async (t) => {
  let calls = 0;
  const { store, meetings, service } = fixture(t, async () => { calls++; throw new Error('offline'); });
  meetings.set('a', meeting('a', '科研合作项目'));
  await service.tick(); await service.tick();
  assert.equal(calls, 1);
  assert.equal(store.db.prepare('SELECT attempts FROM memory_jobs').get().attempts, 1);
  assert.equal(store.status().pending, 1);
});

test('no model still automatically indexes raw evidence', async (t) => {
  const { store, meetings, service } = fixture(t, () => { throw new Error('must not call'); });
  service.modelAvailable = () => false;
  meetings.set('a', meeting('a', '预算金额八万元'));
  await service.tick();
  assert.equal(store.search('预算')[0].meetingId, 'a');
});

test('automatic answers bind citations, reject invented references and detect source changes', async (t) => {
  let response = { answer: '预算八万元。[1]', citations: [1] };
  const { meetings, service } = fixture(t, async () => ({ content: JSON.stringify(response), model: 'test' }));
  meetings.set('a', meeting('a', '预算金额八万元'));
  const result = await service.answer({ question: '预算是多少' });
  assert.equal(result.citations[0].meetingId, 'a');
  response = { answer: '十万元。[99]', citations: [99] };
  await assert.rejects(service.answer({ question: '预算' }), /不存在/);
  service.ask = async () => { meetings.delete('a'); return { content: '{"answer":"八万元[1]","citations":[1]}' }; };
  await assert.rejects(service.answer({ question: '预算' }), /变更/);
});

test('no evidence means no model call or fabricated memory', async (t) => {
  const { service } = fixture(t, () => { throw new Error('must not call'); });
  const result = await service.answer({ question: '预算是多少' });
  assert.deepEqual(result.citations, []);
  assert.match(result.answer, /未找到/);
});

test('explicit selected overview samples all parts without leaking other meetings', async (t) => {
  const { store, meetings, service } = fixture(t);
  meetings.set('a', meeting('a', '科研项目首版计划。'));
  meetings.set('b', meeting('b', '其他项目的私有背景。'));
  const hits = await service.recall('总结一下', { meetingIds: ['a'] });
  assert.ok(hits.length);
  assert.ok(hits.every((c) => c.meetingId === 'a'));
  assert.equal(store.status().sources, 2);
});

test('in-flight extraction is recoverable after restart and facts are idempotent', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'viaim-memory-restart-'));
  const filename = path.join(dir, 'test.db');
  let store = new MemoryStore(filename);
  t.after(() => { store.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  store.upsert(meeting('a', '项目交付日期改为下月十号。'));
  store.nextJob(); store.close(); store = new MemoryStore(filename);
  const job = store.nextJob();
  assert.ok(job);
  const facts = [{ chunkId: job.chunks[0].id, kind: 'change', subject: '项目', claim: '交付改为下月十号', quote: '交付日期改为下月十号' }];
  store.finishJob(job, facts); store.finishJob(job, facts);
  assert.equal(store.status().facts, 1);
  assert.equal(store.status().pending, 0);
  assert.equal(store.search('交付')[0].facts[0].kind, 'change');
});

test('derived search index is rebuildable while evidence and extracted facts survive', (t) => {
  const { store } = fixture(t);
  store.upsert(meeting('a', '预算需要减少两万元。'));
  const job = store.nextJob();
  store.finishJob(job, [{ chunkId: job.chunks[0].id, kind: 'fact', subject: '预算', claim: '成本压缩两万元', quote: '预算需要减少两万元' }]);
  assert.ok(store.search('成本压缩').length);
  const before = store.status();
  store.db.exec('DELETE FROM memory_fts');
  store.rebuildIndex();
  assert.deepEqual(store.status(), before);
  assert.equal(store.search('预算')[0].excerpt, '张老师: 预算需要减少两万元。');
  assert.ok(store.search('成本压缩').length);
});
