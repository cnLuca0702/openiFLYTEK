// 录音转写服务：
//   本地 whisper.cpp（离线免费，Apple Silicon Metal 加速）/ 智谱 glm-asr 云端识别
//   引擎选择由用户配置决定：asr.mode = local | online | stream；asr.priority = local | online
// 说明：Electron 内没有 Web Speech API，实时转写通过「流式模式」实现（录音中分段增量识别）。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveProviderRuntime, getAsrConfig } from './llm_config.js';
import { notebookStore } from './notebook_store.js';

const ZHIPU_ASR_URL = 'https://open.bigmodel.cn/api/paas/v4/audio/transcriptions';
const CHUNK_MS = 10 * 60 * 1000; // 云端整段识别按 10 分钟切片，避免超长音频被服务端拒绝

// whisper.cpp 模型目录与偏好顺序（数值越小越优先）
const WHISPER_MODEL_DIRS = [path.join(os.homedir(), '.cache/whisper'), '/opt/homebrew/share/whisper.cpp'];
const WHISPER_MODEL_PREFERENCE = [
  /large-v3-turbo/i, /large-v3/i, /large/i, /medium/i, /small/i, /base/i, /tiny/i,
];

function toolPath(name) {
  return ['/opt/homebrew/bin', '/usr/local/bin'].map(dir => path.join(dir, name)).find(p => fs.existsSync(p)) || name;
}

function ensureFfmpeg() {
  const probe = spawnSync(toolPath('ffmpeg'), ['-version'], { encoding: 'utf8' });
  if (probe.error || probe.status !== 0) {
    throw new Error('缺少音频转换工具，请在语音转写设置中点击“一键安装本地转写”');
  }
}

function toWav(inputPath, outPath, fromSec = null, durSec = null) {
  const args = ['-y', '-loglevel', 'error', '-i', inputPath];
  if (fromSec != null) args.push('-ss', String(fromSec));
  if (durSec != null) args.push('-t', String(durSec));
  args.push('-ar', '16000', '-ac', '1', outPath);
  const r = spawnSync(toolPath('ffmpeg'), args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`音频转码失败: ${(r.stderr || '').slice(0, 200)}`);
}

// ==================== 本地 whisper.cpp ====================

export function findWhisperCli() {
  const probe = spawnSync(toolPath('whisper-cli'), ['-h'], { encoding: 'utf8', timeout: 5000 });
  return probe.error || probe.status !== 0 ? null : toolPath('whisper-cli');
}

export function findWhisperModel() {
  for (const dir of WHISPER_MODEL_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const pattern of WHISPER_MODEL_PREFERENCE) {
      const hit = fs.readdirSync(dir)
        .filter((f) => /^ggml-.+\.bin$/i.test(f) && pattern.test(f))
        .sort((a, b) => fs.statSync(path.join(dir, b)).size - fs.statSync(path.join(dir, a)).size)[0];
      if (hit) return path.join(dir, hit);
    }
  }
  return null;
}

export function localAsrAvailable() {
  return Boolean(findWhisperCli() && findWhisperModel() && ffmpegAvailable());
}

export function onlineAsrAvailable() {
  return Boolean(resolveProviderRuntime('glm').apiKey);
}

// 返回 [{startMs,endMs,text}]；不可用/失败抛错（由调用方决定是否回退）
function transcribeWithWhisper(wavPath) {
  const cli = findWhisperCli();
  if (!cli) throw new Error('缺少本地识别引擎，请在语音转写设置中点击“一键安装本地转写”');
  const model = findWhisperModel();
  if (!model) throw new Error('缺少本地语音模型，请在语音转写设置中点击“一键安装本地转写”');

  const outBase = `${wavPath}.whisper`;
  const r = spawnSync(cli, [
    '-m', model,
    '-f', wavPath,
    '-l', 'zh',
    '-oj', '-of', outBase,
    '--prompt', '以下是普通话的句子。', // 引导输出简体中文
  ], { encoding: 'utf8' });

  const jsonPath = `${outBase}.json`;
  try {
    if (r.status !== 0 || !fs.existsSync(jsonPath)) {
      throw new Error(`本地 whisper 识别失败: ${(r.stderr || '').slice(0, 200)}`);
    }
    const data = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const list = Array.isArray(data.transcription) ? data.transcription : [];
    const segments = list
      .map((seg) => ({
        startMs: Number(seg?.offsets?.from ?? 0),
        endMs: Number(seg?.offsets?.to ?? 0),
        text: String(seg?.text || '').trim(),
      }))
      .filter((s) => s.text);
    if (!segments.length) throw new Error('本地 whisper 未识别到任何人声内容');
    return segments;
  } finally {
    try { fs.unlinkSync(jsonPath); } catch (_) { /* 清理失败忽略 */ }
  }
}

// ==================== 云端智谱 glm-asr ====================

async function asrOne(apiKey, wavPath) {
  const buf = fs.readFileSync(wavPath);
  const form = new FormData();
  form.append('model', 'glm-asr');
  form.append('file', new Blob([buf], { type: 'audio/wav' }), 'audio.wav');
  const res = await fetch(ZHIPU_ASR_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = String(text).slice(0, 200);
    try { msg = JSON.parse(text)?.error?.message || msg; } catch (_) { /* 保留原文 */ }
    if (res.status === 401 || res.status === 403) {
      throw new Error('GLM API Key 无效或无语音识别权限，请检查「设置 → 大模型引擎」中的 GLM 配置');
    }
    throw new Error(`智谱语音识别失败（HTTP ${res.status}）: ${msg}`);
  }
  let data;
  try { data = JSON.parse(text); } catch (_) { throw new Error('智谱语音识别返回了非 JSON 响应'); }
  return Array.isArray(data.segments) ? data.segments : [];
}

// ==================== 引擎调度 ====================

// 按用户配置返回引擎尝试顺序：['local','online'] 或 ['online','local']
function engineOrder(asr) {
  const order = asr.priority === 'online' ? ['online', 'local'] : ['local', 'online'];
  if (asr.mode === 'local') return ['local'];
  if (asr.mode === 'online') return ['online'];
  return order; // stream / 其他：按优先级自动回退
}

async function transcribeWavByEngines(wavPath, order, label, { emptyOk = false } = {}) {
  const errors = [];
  for (const engine of order) {
    try {
      if (engine === 'local') {
        if (!localAsrAvailable()) throw new Error('本地 whisper.cpp 不可用');
        let segments;
        try {
          segments = transcribeWithWhisper(wavPath);
        } catch (err) {
          if (emptyOk && /未识别到任何人声/.test(err.message)) return { segments: [], engine: 'local-whisper' };
          throw err;
        }
        return { segments, engine: 'local-whisper' };
      }
      const apiKey = resolveProviderRuntime('glm').apiKey;
      if (!apiKey) throw new Error('未配置 GLM API Key（云端转写不可用）');
      const segs = await asrOne(apiKey, wavPath);
      const segments = segs
        .map((s) => ({
          startMs: Math.round(Number(s.start || 0) * 1000),
          endMs: Math.round(Number(s.end || 0) * 1000),
          text: String(s.text || '').trim(),
        }))
        .filter((s) => s.text);
      if (!segments.length) {
        if (emptyOk) return { segments: [], engine: 'glm-asr' };
        throw new Error('云端未识别到任何人声内容');
      }
      return { segments, engine: 'glm-asr' };
    } catch (err) {
      errors.push(`${engine}: ${err.message}`);
    }
  }
  throw new Error(`${label}失败（已尝试 ${order.join(' → ')}）：${errors.join('；')}`);
}

export function isMarkerSentence(s) {
  return /📌|重点标记|标记点/.test(String(s?.text || ''));
}

// ==================== 整场转写（录音结束后 / 手动补转写） ====================

export async function transcribeMeetingAudio(meetingId) {
  const meeting = notebookStore.getProjectMeeting(meetingId);
  if (!meeting) throw new Error('会议不存在');
  const audioPath = notebookStore.getProjectAudioPath(meetingId);
  if (!audioPath || !fs.existsSync(audioPath)) throw new Error('该会议没有可转写的音频文件');
  ensureFfmpeg();

  const asr = getAsrConfig();
  const order = engineOrder(asr);
  const durationMs = Number(meeting.durationMs || 0);
  const tmpBase = path.join(os.tmpdir(), `viaim-asr-${Date.now()}`);
  const tmpFiles = [];

  try {
    let segments;
    let engine;

    if (order.includes('online') && !order.includes('local')) {
      // 仅云端：按 10 分钟切片
      const apiKey = resolveProviderRuntime('glm').apiKey;
      if (!apiKey) throw new Error('在线转写需要 GLM API Key，请先在「设置 → 大模型引擎」配置并保存');
      segments = [];
      const collected = [];
      const total = Math.max(1, Math.ceil(durationMs / CHUNK_MS));
      for (let i = 0; i < total; i++) {
        const p = `${tmpBase}-${i}.wav`;
        tmpFiles.push(p);
        toWav(audioPath, p, (i * CHUNK_MS) / 1000, CHUNK_MS / 1000);
        const segs = await asrOne(apiKey, p);
        for (const s of segs) {
          const text = String(s.text || '').trim();
          if (!text) continue;
          collected.push({
            startMs: i * CHUNK_MS + Math.round(Number(s.start || 0) * 1000),
            endMs: i * CHUNK_MS + Math.round(Number(s.end || 0) * 1000),
            text,
          });
        }
      }
      segments = collected;
      engine = 'glm-asr';
      if (!segments.length) throw new Error('语音识别未识别到任何人声内容，已保留原转写不变');
    } else {
      // 本地（或本地优先）：整段 wav，失败自动顺延到云端
      const wav = `${tmpBase}-local.wav`;
      tmpFiles.push(wav);
      toWav(audioPath, wav);
      ({ segments, engine } = await transcribeWavByEngines(wav, order, '音频转写'));
    }

    return finishTranscription(meeting, meetingId, segments, engine);
  } finally {
    for (const f of tmpFiles) {
      try { fs.unlinkSync(f); } catch (_) { /* 临时文件清理失败忽略 */ }
    }
  }
}

function finishTranscription(meeting, meetingId, segments, engine) {
  // 与原有标记点按时间合并；丢弃保存时的占位句
  const markers = (meeting.sentences || []).filter((s) => isMarkerSentence(s));
  const merged = [
    ...markers.map((s) => ({
      speaker: s.speaker || '重点打标',
      startMs: Number(s.startTimeMs || 0),
      endMs: Number(s.endTimeMs || 0),
      text: s.text,
    })),
    ...segments.map((s) => ({
      speaker: '我',
      startMs: Number(s.startMs || 0),
      endMs: Number(s.endMs || 0),
      text: s.text,
    })),
  ].sort((a, b) => a.startMs - b.startMs);

  const updated = notebookStore.replaceProjectSentences(meetingId, merged);
  updated.asrEngine = engine;
  return updated;
}

// ==================== 流式增量转写（录音中调用） ====================

// 传入「截至当前的完整录音」+ 上次已识别到的毫秒位，只识别新增尾部并返回绝对时间戳分段
export async function transcribeLiveTail({ audioBuffer, fromMs = 0 }) {
  ensureFfmpeg();
  if (!audioBuffer?.length) return { segments: [], engine: null, nextFromMs: fromMs };

  const asr = getAsrConfig();
  const order = engineOrder({ ...asr, mode: asr.mode }); // 流式同样按优先级回退
  const tmpBase = path.join(os.tmpdir(), `viaim-live-${Date.now()}`);
  const webmPath = `${tmpBase}.webm`;
  const wavPath = `${tmpBase}.wav`;
  try {
    fs.writeFileSync(webmPath, audioBuffer);
    const fromSec = Math.max(0, Number(fromMs || 0) / 1000);
    toWav(webmPath, wavPath, fromSec);

    // 空尾守卫：-ss 超出音频末尾时 ffmpeg 只输出 wav 头（<200B），直接返回空
    if (fs.existsSync(wavPath) && fs.statSync(wavPath).size < 200) {
      return { segments: [], engine: null, nextFromMs: Number(fromMs || 0) };
    }

    // 流式尾部允许「无新语音」：静音段正常返回空，不算错误
    const { segments, engine } = await transcribeWavByEngines(wavPath, order, '流式转写', { emptyOk: true });
    // 只保留起始点在已识别进度之后的分段，推进 nextFromMs 到最后一段的结束点
    const fresh = segments.filter((s) => s.startMs >= Number(fromMs || 0));
    const nextFromMs = fresh.length ? Math.max(...fresh.map((s) => s.endMs || s.startMs)) : Number(fromMs || 0);
    return { segments: fresh, engine, nextFromMs };
  } finally {
    for (const f of [webmPath, wavPath]) {
      try { fs.unlinkSync(f); } catch (_) { /* 清理失败忽略 */ }
    }
  }
}

function ffmpegAvailable() {
  const probe = spawnSync(toolPath('ffmpeg'), ['-version'], {encoding:'utf8',timeout:5000});
  return !probe.error && probe.status === 0;
}

// ASR 环境状态（设置面板展示用）
export function getAsrStatus() {
  return {
    local: {
      available: localAsrAvailable(),
      cli: Boolean(findWhisperCli()),
      ffmpeg: ffmpegAvailable(),
      model: findWhisperModel() ? path.basename(findWhisperModel()) : '',
    },
    online: {
      available: onlineAsrAvailable(),
    },
  };
}
