const SPEAKER_MARKER_TYPE = 1610612737;

// 已观测到的转写条目类型：
//   1610612737 (0x60000001) 说话人标记，content 为说话人名称
//   1073741825 (0x40000001) 说话人分离模式下的文字
//   1          普通（未开启说话人分离）模式下的文字
// 说话人标记之外、带文本内容的条目一律视为转写文字，避免新格式被整篇丢弃。
function isSpeakerMarker(type) {
  return type === SPEAKER_MARKER_TYPE || ((type >>> 28) & 0xf) === 6;
}

export function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatTime(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

export function chooseNoteTitle(rawDetail, content) {
  const name = rawDetail?.noteName || rawDetail?.title || content?.noteInfo?.name || content?.noteInfo?.noteName;
  if (typeof name === 'string' && name.trim()) return name.trim();
  const time = Number(rawDetail?.createTime || rawDetail?.protime || Date.now());
  return `办公本笔记 ${new Date(time).toLocaleString('zh-CN')}`;
}

export function parseDetailContent(rawDetail) {
  let content = rawDetail?.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch (_) {
      content = null;
    }
  }
  if (!content || typeof content !== 'object') content = {};

  const audioObjectName = typeof content?.audio?.audioPath === 'string'
    ? content.audio.audioPath.split('/').pop()
    : '';
  const transcriptObjectName = typeof content?.text?.onlineTransferTextPath === 'string'
    ? content.text.onlineTransferTextPath.split('/').pop()
    : '';
  const durationMs = Number(content?.audio?.audioDuration || rawDetail?.wavTime || rawDetail?.audioDuration || 0) || 0;

  return {
    rawDetail,
    content,
    title: chooseNoteTitle(rawDetail, content),
    noteId: String(rawDetail?.noteId || rawDetail?.id || ''),
    type: Number(rawDetail?.type || 0),
    userId: String(rawDetail?.userId || ''),
    createTime: Number(rawDetail?.createTime || rawDetail?.protime || Date.now()),
    syncTime: Number(rawDetail?.syntime || rawDetail?.updateTime || Date.now()),
    dirId: String(rawDetail?.dir || rawDetail?.dirId || ''),
    dirName: rawDetail?.dirName || '',
    isEncrypt: Number(rawDetail?.isEncrypt || 0),
    audioObjectName,
    transcriptObjectName,
    durationMs,
    hasAudio: Boolean(audioObjectName),
  };
}

function normalizeSpeaker(value, fallback = '说话人 1') {
  const text = String(value || '').trim();
  return text || fallback;
}

export function mergeLeadingPunctuation(sentences) {
  const leadingPunctuation = /^[。！？；：，、,.!?;:]+/;
  const merged = [];
  for (const sentence of sentences) {
    const text = String(sentence.text || '').trim();
    if (!text) continue;
    const match = text.match(leadingPunctuation);
    if (match && merged.length > 0) {
      merged[merged.length - 1].text += match[0];
      const rest = text.slice(match[0].length).trim();
      if (!rest) continue;
      merged.push({ ...sentence, text: rest });
    } else {
      merged.push({ ...sentence, text });
    }
  }
  return merged;
}

export function parseRecordTranscript(payload, noteId = '') {
  const entries = Array.isArray(payload) ? payload : [];
  let speaker = '说话人 1';
  let ordinal = 0;
  const sentences = [];

  for (const entry of entries) {
    const type = Number(entry?.type);
    if (isSpeakerMarker(type)) {
      speaker = normalizeSpeaker(entry?.content, speaker);
      continue;
    }
    const text = String(entry?.content || '').trim();
    if (!text) continue;
    const startTimeMs = Number(entry?.beginTimeMills ?? entry?.startTime ?? 0) || 0;
    const endTimeMs = Number(entry?.endTimeMills ?? entry?.endTime ?? startTimeMs) || startTimeMs;
    sentences.push({
      id: `${noteId || 'note'}_${ordinal++}`,
      ordinal: ordinal - 1,
      segment: Number(entry?.segment || 0),
      speaker,
      time: formatTime(startTimeMs),
      startTimeMs,
      endTimeMs,
      text,
      trans: '',
    });
  }
  return mergeLeadingPunctuation(sentences).map((sentence, index) => ({ ...sentence, ordinal: index }));
}
