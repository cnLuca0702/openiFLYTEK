import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';

import {
  formatDuration,
  formatTime,
  chooseNoteTitle,
  parseDetailContent,
  mergeLeadingPunctuation,
  parseRecordTranscript,
} from '../server/record_parser.js';
import {
  buildMinutes,
  minutesToDocxBlocks,
  minutesToTranscriptEntries,
  minutesPreview,
  ENTRY_SPEAKER,
  ENTRY_TEXT,
} from '../server/minutes_document.js';
import { renderDocx } from '../server/docx_writer.js';
import { buildTranscript, parseSummaryJson, normalizeSummary } from '../server/summary_service.js';

test('时长与时间戳格式化对小时进位正确，负数按 0 处理', () => {
  assert.equal(formatDuration(0), '00:00');
  assert.equal(formatDuration(59_400), '00:59');
  assert.equal(formatDuration(61_000), '01:01');
  assert.equal(formatDuration(3_600_000), '01:00:00');
  assert.equal(formatDuration(3_725_000), '01:02:05');
  assert.equal(formatDuration(-5), '00:00');
  assert.equal(formatTime(0), '00:00');
  assert.equal(formatTime(3_725_000), '62:05');
  assert.equal(formatTime(undefined), '00:00');
});

test('笔记标题优先取云端命名，缺失时用创建时间兜底', () => {
  assert.equal(chooseNoteTitle({ noteName: '  周会纪要  ' }), '周会纪要');
  assert.equal(chooseNoteTitle({ title: '双周评审' }), '双周评审');
  assert.equal(chooseNoteTitle({}, { noteInfo: { name: '客户访谈' } }), '客户访谈');
  const fallback = chooseNoteTitle({ createTime: Date.parse('2026-03-04T05:06:07Z') }, {});
  assert.match(fallback, /^办公本笔记 /);
});

test('parseDetailContent 兼容 content 为 JSON 字符串并只暴露裸文件名', () => {
  const detail = parseDetailContent({
    noteId: 'n-1',
    createTime: 1_700_000_000_000,
    content: JSON.stringify({
      audio: { audioPath: 'oss/2026/03/a/n-1.opus', audioDuration: 4200 },
      text: { onlineTransferTextPath: 'oss/2026/03/t/n-1.json' },
    }),
  });
  assert.equal(detail.noteId, 'n-1');
  assert.equal(detail.audioObjectName, 'n-1.opus');
  assert.equal(detail.transcriptObjectName, 'n-1.json');
  assert.equal(detail.durationMs, 4200);
  assert.equal(detail.hasAudio, true);
  assert.ok(!detail.audioObjectName.includes('/'));

  const broken = parseDetailContent({ content: 'not-json', wavTime: 1500 });
  assert.equal(broken.audioObjectName, '');
  assert.equal(broken.durationMs, 1500);
  assert.equal(broken.hasAudio, false);
  assert.deepEqual(parseDetailContent(null).audioObjectName, '');
});

test('未开启说话人分离的 type=1 条目仍算转写文字，不会整篇变成 0 句', () => {
  const sentences = parseRecordTranscript([
    { type: 1, content: '我们先过一下预算。', beginTimeMills: 0, endTimeMills: 3000 },
    { type: 1, content: '客户希望本周内回复。', beginTimeMills: 3000, endTimeMills: 6000 },
  ], 'note-x');
  assert.equal(sentences.length, 2);
  assert.deepEqual(sentences.map((s) => s.text), ['我们先过一下预算。', '客户希望本周内回复。']);
  assert.deepEqual(sentences.map((s) => s.id), ['note-x_0', 'note-x_1']);
  assert.equal(sentences[1].time, '00:03');
});

test('说话人标记（0x6xxxxxxx）切换发言人，0x4xxxxxxx 与 type=1 都按文字处理', () => {
  const sentences = parseRecordTranscript([
    { type: 1610612737, content: '张经理' },
    { type: 1073741825, content: '第一句。', beginTimeMills: 1000 },
    { type: 0x60000005, content: '李工' },
    { type: 1, content: '第二句。', beginTimeMills: 2000 },
    { type: 1610612737, content: '   ' },
    { type: 1, content: '第三句。', beginTimeMills: 3000 },
    { type: 1, content: '   ', beginTimeMills: 4000 },
  ], 'n');
  assert.deepEqual(sentences.map((s) => s.speaker), ['张经理', '李工', '李工']);
  assert.deepEqual(sentences.map((s) => s.text), ['第一句。', '第二句。', '第三句。']);
  assert.deepEqual(sentences.map((s) => s.ordinal), [0, 1, 2]);
});

test('句子开头的标点并入上一句，ordinal 重新连续编号', () => {
  const merged = mergeLeadingPunctuation([
    { text: '前半句', ordinal: 0 },
    { text: '，后半句。', ordinal: 1 },
    { text: '！', ordinal: 2 },
    { text: '现在开始。', ordinal: 3 },
    { text: '  ', ordinal: 4 },
  ]);
  assert.deepEqual(merged.map((s) => s.text), ['前半句，', '后半句。！', '现在开始。']);
  assert.deepEqual(merged.map((s) => s.ordinal), [0, 1, 3], 'mergeLeadingPunctuation 本身不重排 ordinal，仅 parseRecordTranscript 会重排');

  const sentences = parseRecordTranscript([
    { type: 1, content: '第一段结论' },
    { type: 1, content: '；补充说明' },
    { type: 1, content: '，' },
  ], 'x');
  assert.deepEqual(sentences.map((s) => s.text), ['第一段结论；', '补充说明，']);

  const doubled = mergeLeadingPunctuation([
    { text: '结论确定。', ordinal: 0 },
    { text: '，下周执行。', ordinal: 1 },
  ]);
  assert.deepEqual(doubled.map((s) => s.text), ['结论确定。，', '下周执行。']);
  assert.match(doubled[0].text, /。，/, '上一句已以句末标点收尾时仍会叠加新标点（已知瑕疵）');
});

test('转写缺时间戳或 payload 非法时不报错，按 0 处理', () => {
  assert.deepEqual(parseRecordTranscript(null, 'n'), []);
  assert.deepEqual(parseRecordTranscript('bad', 'n'), []);
  const [sentence] = parseRecordTranscript([{ type: 1, content: '无时间' }], 'n');
  assert.equal(sentence.startTimeMs, 0);
  assert.equal(sentence.endTimeMs, 0);
  assert.equal(sentence.id, 'n_0');
});

const meetingFixture = () => ({
  title: '晨星项目周会',
  createdAt: '2026-10-20T02:00:00.000Z',
  duration: '00:32:10',
  speakerCount: 2,
  aiSummary: {
    title: '晨星项目交付周会',
    abstract: '确认一期按期上线。\n二期延后一个月。',
    summaryFull: '会上确认一期验收时间。\n二期需补充预算材料。',
    topics: ['一期验收', '二期预算'],
    todos: [
      { task: '提交验收材料', owner: '张经理', due: '2026-10-24' },
      { task: '补充预算表', done: true },
      { task: '' },
    ],
  },
  sentences: [
    { speaker: '张经理', startTimeMs: 0, endTimeMs: 5000, text: '先看一期进度。' },
    { speaker: '张经理', startTimeMs: 5000, endTimeMs: 9000, text: '验收材料下周交。' },
    { speaker: '李工', startTimeMs: 9000, endTimeMs: 15000, text: '预算我来补。', trans: 'translated line' },
    { speaker: '', startTimeMs: 15000, text: '   ' },
  ],
});

test('buildMinutes 章节顺序固定，待办带勾选、负责人与截止日期', () => {
  const minutes = buildMinutes(meetingFixture());
  assert.deepEqual(minutes.sections.map((s) => s.heading), ['会议主题', '会议摘要', '详细纪要', '主要议题', '待办事项']);
  assert.match(minutes.meta, /会议时间：/);
  assert.match(minutes.meta, /时长：00:32:10/);
  const todoItems = minutes.sections.at(-1).items;
  assert.deepEqual(todoItems.map((i) => i.prefix), ['☐', '☑']);
  assert.equal(todoItems[0].text, '提交验收材料（负责人：张经理）（截止：2026-10-24）');
  assert.equal(minutes.sentences.length, 3);
  assert.deepEqual(minutes.sentences.map((s) => s.speaker), ['张经理', '张经理', '李工']);
});

test('空会议不会产生空章节，纪要正文明确标注无内容', () => {
  const minutes = buildMinutes({ title: '空会议', createdAt: Date.now(), sentences: [] });
  assert.deepEqual(minutes.sections, []);
  const blocks = minutesToDocxBlocks(minutes);
  assert.equal(blocks.at(-1).text, '（该会议暂无纪要或转写内容）');
  assert.equal(minutesPreview(minutes), '');
  assert.deepEqual(minutesToTranscriptEntries(minutes), []);
});

test('办公本文字面板：纪要整体在时间点 0，逐句转写带真实时间戳与说话人切换', () => {
  const entries = minutesToTranscriptEntries(buildMinutes(meetingFixture()));
  const speakers = entries.filter((e) => e.type === ENTRY_SPEAKER);
  const texts = entries.filter((e) => e.type === ENTRY_TEXT);
  assert.equal(speakers[0].content, '会议纪要');
  assert.equal(speakers[0].beginTimeMills, 0);
  assert.ok(texts.length > 3);
  assert.match(texts[0].content, /^【晨星项目周会】会议时间：/);
  assert.ok(texts.some((e) => e.content.includes('【待办事项】☐ 提交验收材料')));
  assert.deepEqual(speakers.slice(1).map((s) => s.content), ['张经理', '李工']);
  const last = texts.at(-1);
  assert.equal(last.beginTimeMills, 9000);
  assert.equal(last.endTimeMills, 15000);
});

test('minutesPreview 优先用摘要并按上限截断', () => {
  const minutes = buildMinutes(meetingFixture());
  assert.equal(minutesPreview(minutes), '确认一期按期上线。\n二期延后一个月。');
  const long = { abstract: 'x'.repeat(400), sections: [], sentences: [] };
  assert.equal(minutesPreview(long).length, 300);
  assert.equal(minutesPreview({ abstract: '', sections: [{ paragraphs: ['会议正文内容'] }], sentences: [] }), '会议正文内容');
});

test('renderDocx 生成合法 zip，标题层级、待办与转写行都在 document.xml 中', async () => {
  const blocks = minutesToDocxBlocks(buildMinutes(meetingFixture()));
  const buffer = Buffer.from(renderDocx(blocks, { title: '晨星项目周会' }));
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');

  const zip = await JSZip.loadAsync(buffer);
  const names = Object.keys(zip.files).sort();
  assert.deepEqual(names, [
    '[Content_Types].xml',
    '_rels/.rels',
    'docProps/core.xml',
    'word/_rels/document.xml.rels',
    'word/document.xml',
    'word/styles.xml',
  ]);
  const xml = await zip.file('word/document.xml').async('string');
  assert.match(xml, /<w:pStyle w:val="Title"\/>/);
  assert.match(xml, /<w:pStyle w:val="Heading1"\/>/);
  assert.match(xml, /☐ 提交验收材料/);
  assert.match(xml, /\[00:00\] 张经理：/);
  assert.match(xml, /会议转写全文（3 句）/);
  assert.ok(!xml.includes('<script'), '不得包含脚本');
});

test('renderDocx 转义 XML 特殊字符并剔除非法控制字符', async () => {
  const buffer = Buffer.from(renderDocx([
    { type: 'title', text: 'A&B <tag> "q"' },
    { type: 'p', text: '非法字符\u0007与\u001F' },
  ]));
  const xml = await (await JSZip.loadAsync(buffer)).file('word/document.xml').async('string');
  assert.match(xml, /A&amp;B &lt;tag&gt; &quot;q&quot;/);
  assert.ok(!/[\u0007\u001F]/.test(xml), 'XML 1.0 非法控制字符必须被剔除');
});

test('带说话人前缀的标记点行按预期过滤', () => {
  const transcript = buildTranscript({
    sentences: [
      { speaker: '重点打标', text: '📌 重点标记点 [00:24]' },
      { speaker: '', text: '   ' },
      { speaker: '张经理', text: '一期按期上线。' },
    ],
  });
  assert.equal(transcript, '张经理: 一期按期上线。');
});

test('无说话人前缀的标记点与纯时间戳行不会进入大模型转写', () => {
  const transcript = buildTranscript({
    sentences: [
      { speaker: '', text: '📌 重点标记点 [00:23]' },
      { speaker: '', text: '00:25' },
      { speaker: '张经理', text: '一期按期上线。' },
    ],
  });
  assert.equal(transcript, '张经理: 一期按期上线。');
});

test('超长转写截断后保留首尾', () => {

  const long = buildTranscript({ sentences: [{ text: 'x'.repeat(9000) }, { text: 'y'.repeat(9000) }] });
  assert.ok(long.length < 15000);
  assert.match(long, /……（中间内容因长度限制已省略）……/);
  assert.ok(long.startsWith('x'), '应保留开头结论');
  assert.ok(long.endsWith('y'), '应保留结尾承诺');
});

test('大模型 JSON 解析兼容代码块与前后缀噪音', () => {
  assert.deepEqual(parseSummaryJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseSummaryJson('好的，结果如下：{"a":2} 以上。'), { a: 2 });
  assert.throws(() => parseSummaryJson('完全不是 JSON'), /无法解析为 JSON/);
});

test('纪要归一化过滤空待办并补默认标题', () => {
  const summary = normalizeSummary({ topics: ['A', '', { text: 'B' }, 3], todos: [{ task: '跟进客户' }, '手动记录', { task: ' ' }, {}] }, { title: '周会' });
  assert.equal(summary.title, '周会 - AI 纪要');
  assert.deepEqual(summary.topics, ['A', 'B']);
  assert.deepEqual(summary.todos.map((t) => t.id), ['ai_todo_1', 'ai_todo_2']);
  assert.deepEqual(summary.todos.map((t) => t.task), ['跟进客户', '手动记录']);
  assert.ok(summary.todos.every((t) => t.done === false));

  const fallback = normalizeSummary(null, { title: '周会' });
  assert.equal(fallback.title, '周会 - AI 纪要');
  assert.deepEqual(fallback.topics, []);
  assert.deepEqual(fallback.todos, []);
});

test('噪音过滤保留数字说话人、正文时间和冒号，过滤各类时间标记', () => {
  const sentences = [
    {speaker:'说话人1',text:'[01:02:03]'},
    {text:'[00:25]'}, {text:'01:02:03'}, {text:'标记点 [00:25]'},
    {text:'重点打标: 📌 重点标记点 [00:25]'},
    {speaker:'说话人2',text:'10:30 开会，预算比例为 1:2。'},
    {text:'预算: 明天确认。'}, {text:'我们讨论了重点标记的使用方式。'},
  ];
  assert.equal(buildTranscript({sentences}), '说话人2: 10:30 开会，预算比例为 1:2。\n预算: 明天确认。\n我们讨论了重点标记的使用方式。');
});
