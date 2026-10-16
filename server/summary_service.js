// 会议纪要提炼服务：组装真实的提示词模板，调用大模型，解析结构化结果并落库
import { chat } from './llm_client.js';
import { notebookStore } from './notebook_store.js';

const MAX_TRANSCRIPT_CHARS = 14000;

// ==================== 总结模板（Prompt Template） ====================

export const SUMMARY_SYSTEM_PROMPT = `你是一名资深的企业会议纪要分析师，擅长把口语化的会议转写整理成结构清晰、结论明确的中文纪要。

工作原则：
1. 只依据转写原文，不得编造任何未出现的事实、数字、人名或承诺。
2. 归纳议题时合并同类讨论，按重要性排序，避免逐句复述。
3. 待办事项必须来自明确的行动意图（谁将做什么），若未指明负责人则 owner 留空字符串。
4. 若转写内容过少或与会议无关，如实说明，不要虚构结论。
5. 输出必须是严格的 JSON 对象，不要使用 Markdown 代码块，不要添加任何解释文字。`;

export const SUMMARY_JSON_SCHEMA = `{
  "title": "字符串，不超过 24 字的纪要标题",
  "abstract": "字符串，80-160 字的核心结论摘要",
  "topics": ["字符串数组，3-6 条主要议题，每条不超过 40 字"],
  "todos": [{ "task": "字符串，具体可执行的任务", "owner": "字符串，负责人，未知则填空字符串" }],
  "summaryFull": "字符串，400-800 字的完整会议纪要，使用自然段落，可分点"
}`;

export function buildSummaryUserPrompt(meeting, transcript) {
  const speakers = new Set((meeting.sentences || []).map((s) => s.speaker).filter(Boolean));
  return `请阅读以下会议转写，提炼结构化会议纪要。

【会议信息】
- 标题：${meeting.title || '未命名会议'}
- 时间：${meeting.createdAt ? new Date(meeting.createdAt).toLocaleString('zh-CN') : '未知'}
- 时长：${meeting.duration || '未知'}
- 发言条数：${(meeting.sentences || []).length}
- 识别到的说话人：${speakers.size > 0 ? [...speakers].join('、') : '未区分'}

【会议转写原文】
${transcript}

【输出要求】
严格按以下 JSON 结构输出，字段名与类型必须完全一致：
${SUMMARY_JSON_SCHEMA}`;
}

// ==================== 转写文本与结果解析 ====================

// 过滤非语音噪音行：重点标记点、纯时间戳等（这类内容对纪要提炼无意义）
function isNoiseLine(line) {
  const bare = String(line || '').replace(/\s+/g, '');
  const isNoise = (text) => !text || /^(📌|🔖|🏷|📍|重点标记|标记点)/u.test(text)
    || /^\[?\d{1,2}:\d{2}(:\d{2})?\]?$/.test(text);
  // Check the original text before considering an embedded speaker prefix.
  // A timestamp colon or bracket must not be mistaken for a speaker delimiter.
  return isNoise(bare) || isNoise(bare.replace(/^[^:：\[\]]{1,24}[:：]/, ''));
}

export function buildTranscript(meeting) {
  const lines = (meeting.sentences || []).filter((s) => !isNoiseLine(s.text)).map((s) => {
    const speaker = s.speaker ? `${s.speaker}: ` : '';
    return `${speaker}${s.text || ''}`.trim();
  }).filter((l) => l && !isNoiseLine(l));

  let text = lines.join('\n');
  if (text.length > MAX_TRANSCRIPT_CHARS) {
    // 超长时保留首尾，避免丢头尾关键信息
    const head = text.slice(0, Math.floor(MAX_TRANSCRIPT_CHARS * 0.7));
    const tail = text.slice(-Math.floor(MAX_TRANSCRIPT_CHARS * 0.25));
    text = `${head}\n……（中间内容因长度限制已省略）……\n${tail}`;
  }
  return text;
}

// 宽容解析模型返回的 JSON：兼容代码块包裹、前后缀文字
export function parseSummaryJson(content) {
  let text = String(content || '').trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) text = fenceMatch[1].trim();
  try {
    return JSON.parse(text);
  } catch (_) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch (_) { /* fallthrough */ }
    }
    throw new Error('大模型返回内容无法解析为 JSON，请重试或更换模型');
  }
}

function toStringArray(value, limit) {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v : v?.text || v?.title || ''))
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, limit);
}

export function normalizeSummary(raw, meeting) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const todos = Array.isArray(source.todos)
    ? source.todos
        .map((t, index) => {
          const task = typeof t === 'string' ? t : String(t?.task || t?.content || '').trim();
          if (!task) return null;
          return {
            id: `ai_todo_${index + 1}`,
            task,
            done: false,
            owner: typeof t?.owner === 'string' ? t.owner.trim() : '',
          };
        })
        .filter(Boolean)
    : [];

  return {
    generated: true,
    title: String(source.title || `${meeting.title || '会议'} - AI 纪要`).trim(),
    abstract: String(source.abstract || source.summary || '').trim(),
    summaryFull: String(source.summaryFull || source.fullSummary || source.abstract || '').trim(),
    topics: toStringArray(source.topics, 8),
    todos,
  };
}

// ==================== 主流程 ====================

export function getStoredSummary(meetingId) {
  return notebookStore.getMeetingSummary(meetingId);
}

export async function generateMeetingSummary(meeting, { force = false } = {}) {
  if (!meeting) throw new Error('会议不存在');

  if (!force) {
    const stored = getStoredSummary(meeting.id);
    if (stored) return stored;
  }

  const transcript = buildTranscript(meeting);
  if (!transcript.trim()) {
    throw new Error('该会议没有有效的转写内容（当前仅包含标记点或空白），无法提炼纪要');
  }

  // 思考型/小参数模型偶发输出字段缺失，空结果自动重试一次
  for (let attempt = 0; attempt < 2; attempt++) {
    const { content, model } = await chat({
      system: SUMMARY_SYSTEM_PROMPT,
      user: buildSummaryUserPrompt(meeting, transcript),
      temperature: attempt === 0 ? 0.3 : 0.1,
      maxTokens: 4096,
      json: true,
    });
    const summary = normalizeSummary(parseSummaryJson(content), meeting);
    if (summary.abstract || summary.summaryFull || summary.topics.length) {
      summary.model = model;
      summary.generatedAt = new Date().toISOString();
      notebookStore.saveMeetingSummary(meeting.id, summary);
      return summary;
    }
  }
  throw new Error('大模型连续两次返回空纪要，请重试或更换模型');
}
