// 会议纪要全文的单一来源：同时供“读写驿站 DOCX”和“办公本录音笔记文字面板”使用，保证两端内容一致。

// 办公本转写附件条目类型（来自真实云笔记附件，见 record_parser.js）
export const ENTRY_SPEAKER = 1610612737; // 说话人标记
export const ENTRY_TEXT = 1073741825; // 文字

const fmtTime = (ms) => {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`;
};

const splitParagraphs = (text) => String(text || '')
  .split(/\n+/)
  .map((s) => s.trim())
  .filter(Boolean);

/** 统一的纪要结构 */
export function buildMinutes(meeting) {
  const summary = meeting.aiSummary || {};
  const createdAt = meeting.createdAt ? new Date(meeting.createdAt) : new Date();
  const title = meeting.title || summary.title || '会议纪要';
  const meta = [
    `会议时间：${createdAt.toLocaleString('zh-CN', { hour12: false })}`,
    meeting.duration ? `时长：${meeting.duration}` : '',
    meeting.speakerCount ? `发言人：${meeting.speakerCount} 位` : '',
  ].filter(Boolean).join('    ');

  const sections = [];
  if (summary.title && summary.title !== title) sections.push({ heading: '会议主题', paragraphs: [summary.title] });
  if (summary.abstract) sections.push({ heading: '会议摘要', paragraphs: splitParagraphs(summary.abstract) });
  if (summary.summaryFull) sections.push({ heading: '详细纪要', paragraphs: splitParagraphs(summary.summaryFull) });
  const topics = Array.isArray(summary.topics) ? summary.topics.filter(Boolean) : [];
  if (topics.length) sections.push({ heading: '主要议题', items: topics.map((t, i) => ({ prefix: `${i + 1}.`, text: String(t) })) });
  const todos = Array.isArray(summary.todos) ? summary.todos.filter((t) => t && t.task) : [];
  if (todos.length) {
    sections.push({
      heading: '待办事项',
      items: todos.map((t) => ({ prefix: t.done ? '☑' : '☐', text: `${t.task}${t.owner ? `（负责人：${t.owner}）` : ''}${t.due ? `（截止：${t.due}）` : ''}` })),
    });
  }

  const sentences = (meeting.sentences || [])
    .filter((s) => s && String(s.text || '').trim())
    .map((s) => ({
      speaker: s.speaker || '发言人',
      startMs: Number.isFinite(Number(s.startTimeMs)) ? Number(s.startTimeMs) : 0,
      endMs: Number.isFinite(Number(s.endTimeMs)) ? Number(s.endTimeMs) : Number(s.startTimeMs) || 0,
      text: String(s.text).trim(),
      trans: s.trans ? String(s.trans).trim() : '',
    }));

  return { title, meta, sections, sentences, abstract: summary.abstract || '' };
}

/** DOCX 区块（读写驿站推送） */
export function minutesToDocxBlocks(minutes) {
  const blocks = [{ type: 'title', text: minutes.title }, { type: 'meta', text: minutes.meta }];
  for (const sec of minutes.sections) {
    blocks.push({ type: 'h1', text: sec.heading });
    for (const p of sec.paragraphs || []) blocks.push({ type: 'p', text: p });
    for (const it of sec.items || []) blocks.push({ type: 'bullet', prefix: it.prefix, text: it.text });
  }
  if (minutes.sentences.length) {
    blocks.push({ type: 'h1', text: `会议转写全文（${minutes.sentences.length} 句）` });
    for (const s of minutes.sentences) {
      blocks.push({ type: 'line', label: `[${fmtTime(s.startMs)}] ${s.speaker}：`, text: s.text });
      if (s.trans) blocks.push({ type: 'meta', text: s.trans });
    }
  }
  if (blocks.length <= 2) blocks.push({ type: 'p', text: '（该会议暂无纪要或转写内容）' });
  return blocks;
}

/**
 * 办公本录音笔记的文字面板条目（onlineTransferTextPath 附件）。
 * 结构：先放「会议纪要」整段（时间点 0），再放带真实时间戳的逐句转写（办公本上点句子可跳转播放）。
 */
export function minutesToTranscriptEntries(minutes) {
  const entries = [];
  const speaker = (name, atMs) => entries.push({ beginTimeMills: atMs, endTimeMills: atMs, content: name, segment: 0, type: ENTRY_SPEAKER });
  const text = (content, b, e) => entries.push({ beginTimeMills: b, endTimeMills: e, content, segment: 0, type: ENTRY_TEXT });

  if (minutes.sections.length) {
    speaker('会议纪要', 0);
    text(`【${minutes.title}】${minutes.meta}`, 0, 0);
    for (const sec of minutes.sections) {
      const lines = [
        ...(sec.paragraphs || []),
        ...(sec.items || []).map((it) => `${it.prefix} ${it.text}`),
      ];
      lines.forEach((line, i) => text(i === 0 ? `【${sec.heading}】${line}` : line, 0, 0));
    }
  }

  let lastSpeaker = null;
  for (const s of minutes.sentences) {
    if (s.speaker !== lastSpeaker) {
      speaker(s.speaker, s.startMs);
      lastSpeaker = s.speaker;
    }
    text(s.text, s.startMs, Math.max(s.endMs, s.startMs));
  }
  return entries;
}

/** 列表摘要（云端 summary 字段，办公本笔记列表的预览文字） */
export function minutesPreview(minutes, max = 300) {
  const src = minutes.abstract
    || minutes.sections.flatMap((s) => s.paragraphs || []).join(' ')
    || minutes.sentences.map((s) => s.text).join('');
  return src.slice(0, max);
}
