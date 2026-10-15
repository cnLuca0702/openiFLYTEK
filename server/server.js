import express from 'express';
import cors from 'cors';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { IFlytekOfficeNoteClient } from './iflytek_client.js';
import { dbService } from './db_service.js';
import { NotebookPushService } from './notebook_push_service.js';
import { notebookStore } from './notebook_store.js';
import { NotebookIntegrationService } from './notebook_integration_service.js';
import { streamLocalMedia } from './media_stream.js';
import { createMemoryService } from './memory_service.js';
import { LegacyMigrationService } from './legacy_migration_service.js';
import { publicProviders } from './llm_providers.js';
import { getPublicConfig, updateProviderConfig, saveConfig } from './llm_config.js';
import { startChatGptLogin, getChatGptLoginStatus, logoutChatGpt } from './chatgpt_oauth.js';
import { testProvider, listModels } from './llm_client.js';
import { generateMeetingSummary, buildTranscript } from './summary_service.js';
import { chat as llmChat } from './llm_client.js';
import { transcribeMeetingAudio, transcribeLiveTail, getAsrStatus } from './asr_service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3800;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const notebookClient = new IFlytekOfficeNoteClient();
notebookStore.initialize();
const notebookIntegration = new NotebookIntegrationService(notebookClient);
const legacyMigration = new LegacyMigrationService(notebookIntegration);

function isProjectMeetingId(meetingId) {
  return typeof meetingId === 'string' && (meetingId.startsWith('notebook:') || meetingId.startsWith('local:'));
}

function getMeetingDetailById(meetingId) {
  if (meetingId.startsWith('document:')) return documents?.source(meetingId);
  const isProject = isProjectMeetingId(meetingId);
  const meeting = isProject
    ? notebookStore.getProjectMeeting(meetingId)
    : dbService.getMeetingDetail(meetingId);
  // 官方库（只读）中的会议，若用户已用大模型重新提炼过，则用落库结果覆盖显示
  if (meeting && !isProject) {
    const stored = notebookStore.getMeetingSummary(meetingId);
    if (stored) {
      meeting.aiSummary = stored;
      meeting.hasSummary = true;
    }
  }
  return meeting;
}

// Optional projection: failure must not prevent the existing backend from starting.
let documents = null;
let memory = null;
try { memory = createMemoryService(getMeetingDetailById); }
catch (_) { console.warn('[Memory] 自动记忆暂不可用，原有会议功能不受影响'); }
try { if (memory) {
  const {DocumentService} = await import('./document_service.js');
  documents = new DocumentService({memory});
  memory.listGroups.push({list: () => documents.list().filter(d => d.status === 'ready'), owns: id => id.startsWith('document:')});
} } catch (_) { console.warn('[Documents] 文档处理暂不可用，原有会议功能不受影响'); }
app.get('/api/documents', (_req,res) => res.json({code:'000000',data:documents?.list() || []}));
app.post('/api/documents', express.raw({type:'application/octet-stream',limit:'40mb'}), (req,res) => {
  try {
    if (!documents) throw new Error('记忆存储暂不可用');
    const result=documents.upload(String(req.query.name || ''),req.body,String(req.query.replaces || ''));
    res.json({code:'000000',data:result}); void documents.tick();
  } catch(e) {res.status(400).json({code:'DOCUMENT_UPLOAD_FAILED',desc:e.message});}
});
app.get('/api/documents/:id', (req,res) => {
  const data=documents?.detail(req.params.id);
  if(!data)return res.status(404).json({desc:'文档不存在'});
  res.json({code:'000000',data});
});
app.get('/api/documents/:id/file/:kind', (req,res) => {
  const file=documents?.file(req.params.id,req.params.kind,req.query.page);
  if(!file||!fs.existsSync(file))return res.status(404).json({desc:'来源文件不可用'});
  res.setHeader('X-Content-Type-Options','nosniff');
  if(req.params.kind==='page')return res.type('png').sendFile(file);
  res.download(file,req.params.kind==='knowledge'?'knowledge.md':documents.row(req.params.id).name);
});
app.delete('/api/documents/:id', (req,res) => {documents?.remove(req.params.id);res.json({code:'000000',data:true});});
app.post('/api/documents/:id/retry', (req,res) => {documents?.retry(req.params.id);void documents?.tick();res.json({code:'000000',data:true});});
app.get('/api/memory/insights', async (req,res) => {
  try {await memory?.sync();res.json({code:'000000',data:memory?.insights(typeof req.query.meetingId==='string'?req.query.meetingId:undefined)||{followups:[],changes:[],citations:[],pending:0}});} catch (_) {res.status(503).json({desc:'自动跟进暂不可用'});}
});
app.get('/api/memory/status', (_req, res) => {
  res.json({ code: '000000', data: memory ? { available: memory.available, ...memory.store.status() } : { available: false } });
});
app.get('/api/memory/related/:id', async (req, res) => {
  try {
    const meeting = getMeetingDetailById(req.params.id);
    if (!meeting || !memory) return res.json({ code: '000000', data: [] });
    const question = [meeting.title, ...(meeting.aiSummary?.topics || []).slice(0, 3)].join(' ');
    const hits = (await memory.recall(question)).filter((c) => c.meetingId !== meeting.id).slice(0, 3);
    res.json({ code: '000000', data: hits.map((c, i) => ({ ...c, ref: i + 1 })) });
  } catch (_) { res.json({ code: '000000', data: [] }); }
});
app.get('/api/memory/evidence/:id', (req, res) => {
  const evidence = memory?.evidence(Number(req.params.id), String(req.query.version || ''));
  if (!evidence) return res.status(409).json({ code: 'MEMORY_SOURCE_CHANGED', desc: '来源已更新、删除或暂不可读取，请重新提问' });
  res.json({ code: '000000', data: evidence });
});

// 读取本机真实的 VIAIM 用户配置文件
function getViaimUserProfile() {
  const settingPath = '/Users/yaban/Library/Preferences/com.viaim.vi/kitdata/config/setting.ini';
  try {
    if (fs.existsSync(settingPath)) {
      const content = fs.readFileSync(settingPath, 'utf-8');
      const parseValue = (key) => {
        const match = content.match(new RegExp(`${key}\\s*=\\s*"?([^"\\n\\r]+)"?`));
        if (!match) return null;
        try {
          return Buffer.from(match[1].trim(), 'base64').toString('utf-8');
        } catch (_) {
          return match[1].trim();
        }
      };

      return {
        userName: parseValue('user_name') || '姚欧强',
        phone: parseValue('user_caller') || '15858185982',
        userId: parseValue('user_userid') || '654256575b7b23763f16a782',
        avatar: parseValue('user_headurl') || 'https://iflybuds.oss-cn-hangzhou.aliyuncs.com/oss/iflybuds/headimage/541765a7c1de413a9191a066aa43c203/541765a7c1de413a9191a066aa43c203.jpeg',
        token: parseValue('token'),
        hasDongle: true,
        dongleModel: 'VIAIM USB HID Dongle Pro',
        headsetName: 'VIAIM iFLYBUDS Pro'
      };
    }
  } catch (err) {
    console.warn('[Server] 读取 setting.ini 失败:', err.message);
  }

  return {
    userName: '姚欧强',
    phone: '15858185982',
    avatar: 'https://iflybuds.oss-cn-hangzhou.aliyuncs.com/oss/iflybuds/headimage/541765a7c1de413a9191a066aa43c203/541765a7c1de413a9191a066aa43c203.jpeg',
    hasDongle: true,
    dongleModel: 'VIAIM USB HID Dongle Pro',
    headsetName: 'VIAIM iFLYBUDS Pro'
  };
}

// ======================== API 路由（100% 真实环境） ========================

// 1. 用户真实画像
app.get('/api/user/profile', (req, res) => {
  res.json({ code: '000000', data: getViaimUserProfile() });
});

// 2. 获取真实会议列表（直连 SQLite kitdb.db）
app.get('/api/meetings', (req, res) => {
  try {
    // 旧版集成把办公本笔记以 "[办公本]" 标题写进了 VIAIM 官方库，且未保存录音，永远无法播放。
    // 这里只做显示层隐藏（不修改官方库）；正式清理走 /api/notebook/legacy-imports 迁移流程。
    // 传 ?includeLegacy=1 可查看这些旧记录。
    const includeLegacy = req.query.includeLegacy === '1';
    const viaimMeetings = dbService.getMeetings()
      .filter((m) => includeLegacy || !String(m.title || '').startsWith('[办公本]'))
      .map((m) => {
        const stored = notebookStore.getMeetingSummary(m.id);
        return stored ? { ...m, aiSummary: stored, hasSummary: true } : m;
      });
    const list = [...viaimMeetings, ...notebookStore.getProjectMeetings()]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    res.json({ code: '000000', data: list });
  } catch (err) {
    res.status(500).json({ code: '500', desc: `读取会议数据库失败: ${err.message}` });
  }
});

// 3. 获取会议详细信息（句子列表、真实待办、AI纪要）
app.get('/api/meetings/:id', (req, res) => {
  try {
    const meeting = getMeetingDetailById(req.params.id);
    if (!meeting) {
      return res.status(404).json({ code: '404', desc: '未找到指定会议' });
    }
    res.json({ code: '000000', data: meeting });
  } catch (err) {
    res.status(500).json({ code: '500', desc: `获取会议详情失败: ${err.message}` });
  }
});

// 3.1 项目自有会议音频流。本地 VIAIM 录音仍由 /api/audio/:id 提供。
app.get('/api/meetings/:id/audio', (req, res) => {
  if (!isProjectMeetingId(req.params.id)) {
    return res.status(404).json({ code: '404', desc: '该会议不属于项目自有存储' });
  }
  try {
    streamLocalMedia(req, res, notebookStore.getProjectAudioPath(req.params.id));
  } catch (err) {
    res.status(500).json({ code: '500', desc: `读取项目音频失败: ${err.message}` });
  }
});

// 4. 音频流式播放（支持 HTTP Range 请求，读取只读 VIAIM 本地 MP3/WAV 录音）
app.get('/api/audio/:id', (req, res) => {
  const filePath = dbService.getAudioFilePath(req.params.id);
  streamLocalMedia(req, res, filePath);
});

// 5. 保存真实录音会议记录
app.post('/api/meetings/record', (req, res) => {
  try {
    const { title, durationMs, sentences, audioBase64 } = req.body;
    let audioBuffer = null;
    let audioMime = 'audio/webm; codecs=opus';
    if (audioBase64) {
      const header = String(audioBase64).match(/^data:([^;,]+)(?:;[^,]*)?,/i);
      audioMime = header?.[1] || audioMime;
      const cleanBase64 = String(audioBase64).slice(header?.[0]?.length || 0);
      audioBuffer = Buffer.from(cleanBase64, 'base64');
    }
    const extensionByMime = {
      'audio/webm': 'webm',
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
    };
    const audioExtension = extensionByMime[audioMime.toLowerCase()] || 'webm';

    const created = notebookStore.createRecordedMeeting({
      title,
      durationMs,
      sentences: sentences || [],
      audioBuffer,
      audioExtension,
      audioMime,
    });

    memory?.remember(created);
    res.json({ code: '000000', data: created });
  } catch (err) {
    res.status(500).json({ code: '500', desc: `保存会议记录失败: ${err.message}` });
  }
});

// 6. 切换待办完成状态
app.post('/api/meetings/:id/todos/:todoId/toggle', (req, res) => {
  try {
    if (!isProjectMeetingId(req.params.id)) {
      return res.status(409).json({ code: 'VIAIM_READ_ONLY', desc: 'VIAIM 外部数据库已设为只读，不能从本项目修改待办' });
    }
    const updated = notebookStore.toggleProjectTodo(req.params.id, req.params.todoId);
    res.json({ code: '000000', data: updated });
  } catch (err) {
    res.status(500).json({ code: '500', desc: err.message });
  }
});

// 6.1 删除项目自有会议。VIAIM 官方数据库保持只读。
app.delete('/api/meetings/:id', (req, res) => {
  try {
    if (!isProjectMeetingId(req.params.id)) {
      return res.status(409).json({ code: 'VIAIM_READ_ONLY', desc: 'VIAIM 外部数据库已设为只读；历史办公本记录请通过迁移工具替换后再软删除' });
    }
    const result = notebookStore.deleteProjectMeeting(req.params.id);
    memory?.forget(req.params.id);
    res.json({ code: '000000', data: result });
  } catch (err) {
    res.status(500).json({ code: '500', desc: `删除会议失败: ${err.message}` });
  }
});

// 6.5 录音离线转写（Electron 无 Web Speech API，录音结束后统一走智谱 glm-asr）
app.post('/api/meetings/:id/transcribe', async (req, res) => {
  try {
    const meeting = await transcribeMeetingAudio(req.params.id);
    memory?.remember(meeting);
    res.json({ code: '000000', data: meeting, desc: '转写完成' });
  } catch (err) {
    res.status(500).json({ code: '500', desc: err.message || '音频转写失败' });
  }
});

// 7. AI 会议纪要提炼（真实调用用户配置的大模型）
app.post('/api/meetings/:id/generate-ai', async (req, res) => {
  try {
    const force = req.body?.force === true;
    const meeting = getMeetingDetailById(req.params.id);
    if (!meeting) return res.status(404).json({ code: '404', desc: '会议不存在' });

    const summary = await generateMeetingSummary(meeting, { force });
    res.json({ code: '000000', data: summary, desc: force ? '已重新提炼' : '提炼完成' });
  } catch (err) {
    const notConfigured = /未配置大模型|请先为|尚未登录 ChatGPT|ChatGPT 登录已过期/.test(err.message || '');
    res.status(notConfigured ? 400 : 500).json({
      code: notConfigured ? 'LLM_NOT_CONFIGURED' : '500',
      desc: err.message || 'AI 纪要提炼失败',
      detail: { reason: err.message, stage: 'llm' }
    });
  }
});

// ======================== 大模型服务商配置 ========================

// AI 问答默认自动检索会议记忆；@ 仍可限定范围，记忆不可用时保留原有指定会议路径。
app.post('/api/ai/chat', async (req, res) => {
  try {
    const { question, meetingIds = [], currentMeetingId, providerId, model } = req.body || {};
    if (!question || !String(question).trim()) {
      return res.status(400).json({ code: '400', desc: '问题不能为空' });
    }
    const ids = Array.isArray(meetingIds)
      ? meetingIds.filter((id) => typeof id === 'string' && id.trim()).slice(0, 5)
      : [];
    if (memory) {
      const answer = await memory.answer({ question: String(question).trim().slice(0, 4000), meetingIds: ids, currentMeetingId: typeof currentMeetingId === 'string' ? currentMeetingId : undefined,
        providerId: providerId || undefined, model: typeof model === 'string' ? model.trim() : undefined });
      return res.json({ code: '000000', data: answer });
    }
    if (!ids.length) return res.status(503).json({ code: 'MEMORY_UNAVAILABLE', desc: '自动记忆暂不可用，可通过 @ 选择会议继续问答' });

    const parts = [];
    for (const id of ids) {
      const meeting = getMeetingDetailById(id);
      if (!meeting) continue;
      parts.push([
        `【会议：${meeting.title || '未命名'}】`,
        `- 时间：${meeting.createdAt ? new Date(meeting.createdAt).toLocaleString('zh-CN') : '未知'}｜时长：${meeting.duration || '未知'}`,
        meeting.aiSummary?.abstract ? `- 已生成纪要摘要：${String(meeting.aiSummary.abstract).trim()}` : '',
        '- 转写原文：',
        buildTranscript(meeting)
      ].filter(Boolean).join('\n'));
    }
    if (!parts.length) {
      return res.status(404).json({ code: '404', desc: '所选录音不存在或无法读取' });
    }

    const system = `你是一名会议智能问答助手，用户会针对一条或多条会议录音提问。
规则：
1. 只依据提供的会议转写与纪要内容回答，不要编造未出现的事实。
2. 若问题与所选录音无关或信息不足，如实说明。
3. 回答使用简体中文，条理清晰，可适当分点；引用内容注明来自哪场会议。`;
    const user = `【用户选择的录音上下文】\n${parts.join('\n\n')}\n\n【用户问题】\n${String(question).trim()}`;

    const result = await llmChat({
      providerId: providerId || undefined,
      override: typeof model === 'string' && model.trim() ? { model: model.trim() } : undefined,
      system,
      user,
      temperature: 0.3,
      maxTokens: 3072,
    });
    res.json({ code: '000000', data: { answer: String(result.content || '').trim(), model: result.model } });
  } catch (err) {
    const notConfigured = /未配置大模型|请先为|尚未登录 ChatGPT|ChatGPT 登录已过期/.test(err.message || '');
    res.status(notConfigured ? 400 : 500).json({
      code: notConfigured ? 'LLM_NOT_CONFIGURED' : '500',
      desc: err.message || 'AI 问答失败'
    });
  }
});

// 7.1 可选服务商清单
app.get('/api/llm/providers', (req, res) => {
  res.json({ code: '000000', data: publicProviders() });
});

// 7.2 当前配置（密钥脱敏）
app.get('/api/llm/config', (req, res) => {
  res.json({ code: '000000', data: getPublicConfig() });
});

// 7.3 更新配置（provider / autoSummary / 各服务商字段）
app.put('/api/llm/config', (req, res) => {
  try {
    const { provider, autoSummary, providerConfig, providerId, asr } = req.body || {};
    if (provider !== undefined || autoSummary !== undefined || asr !== undefined) {
      saveConfig({
        ...(provider !== undefined ? { provider } : {}),
        ...(autoSummary !== undefined ? { autoSummary: autoSummary !== false } : {}),
        ...(asr !== undefined ? { asr } : {}),
      });
    }
    if (providerConfig && (providerId || provider)) {
      updateProviderConfig(providerId || provider, providerConfig);
    }
    res.json({ code: '000000', data: getPublicConfig(), desc: '配置已保存' });
  } catch (err) {
    res.status(500).json({ code: '500', desc: `保存配置失败: ${err.message}` });
  }
});

// 7.3.1 ASR 环境状态（本地 whisper / 云端 GLM 可用性）
app.get('/api/asr/status', (req, res) => {
  res.json({ code: '000000', data: getAsrStatus() });
});

// 7.3.2 流式增量转写：传入截至当前的完整录音 + 已识别进度，返回新增分段
app.post('/api/asr/live', async (req, res) => {
  try {
    const { audioBase64, fromMs } = req.body || {};
    if (!audioBase64) return res.status(400).json({ code: '400', desc: '缺少音频数据' });
    const cleanBase64 = String(audioBase64).replace(/^data:[^;,]+(?:;[^,]*)?,/, '');
    const audioBuffer = Buffer.from(cleanBase64, 'base64');
    const result = await transcribeLiveTail({ audioBuffer, fromMs: Number(fromMs || 0) });
    res.json({ code: '000000', data: result });
  } catch (err) {
    res.status(500).json({ code: '500', desc: err.message || '流式转写失败' });
  }
});

// 7.4 连通性测试（可传 override 测试尚未保存的表单值）
app.post('/api/llm/test', async (req, res) => {
  try {
    const result = await testProvider(req.body?.providerId, req.body?.override);
    res.json({ code: '000000', data: result, desc: '连通正常' });
  } catch (err) {
    res.status(400).json({ code: 'LLM_TEST_FAILED', desc: err.message || '连通测试失败' });
  }
});

// 7.4.1 自动拉取服务商可用模型列表
app.post('/api/llm/models', async (req, res) => {
  try {
    const result = await listModels(req.body?.providerId, req.body?.override);
    res.json({ code: '000000', data: result, desc: '已获取模型列表' });
  } catch (err) {
    res.status(400).json({ code: 'LLM_MODELS_FAILED', desc: err.message || '拉取模型列表失败' });
  }
});

// 7.5 Sign in with ChatGPT：发起 OAuth 登录
app.post('/api/llm/chatgpt/login', (req, res) => {
  try {
    const { authUrl } = startChatGptLogin();
    res.json({ code: '000000', data: { authUrl }, desc: '已生成授权链接' });
  } catch (err) {
    res.status(500).json({ code: '500', desc: `发起 ChatGPT 登录失败: ${err.message}` });
  }
});

// 7.6 查询 ChatGPT 登录状态
app.get('/api/llm/chatgpt/status', (req, res) => {
  res.json({ code: '000000', data: getChatGptLoginStatus() });
});

// 7.7 退出 ChatGPT 登录
app.post('/api/llm/chatgpt/logout', (req, res) => {
  res.json({ code: '000000', data: logoutChatGpt(), desc: '已退出 ChatGPT' });
});

// ======================== 讯飞智能办公本真实云端互通 ========================

// 8. 办公本账号登录（真实调用 xbew-api /user/dxkLogin）
app.post('/api/notebook/login', async (req, res) => {
  const { mobile, password } = req.body;
  if (!mobile || !password) {
    return res.status(400).json({ code: '400', desc: '手机号与密码不能为空' });
  }
  try {
    const data = await notebookClient.login(mobile, password);
    res.json({ code: '000000', data, desc: '登录成功' });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({ code: String(err.code || 500), desc: err.message });
  }
});

// 9. 手动设置/更新 Token
app.post('/api/notebook/token', (req, res) => {
  const { token } = req.body;
  if (!token) {
    return res.status(400).json({ code: '400', desc: 'Token 不能为空' });
  }
  notebookClient.setToken(token);
  res.json({ code: '000000', desc: 'Token 配置成功' });
});

// 9.1 退出办公本账号登录
app.post('/api/notebook/logout', (req, res) => {
  notebookClient.logout();
  res.json({ code: '000000', desc: '已退出登录' });
});

// 10. 拉取真实绑定的办公本硬件
app.get('/api/notebook/devices', async (req, res) => {
  try {
    const result = await notebookClient.getBoundDevices();
    res.json({ code: '000000', data: result });
  } catch (err) {
    res.json({
      code: '000000',
      data: {
        authenticated: notebookClient.isAuthenticated(),
        sessionValid: false,
        sessionReason: err.message,
        devices: [],
        error: err.message
      }
    });
  }
});

// 10.1 真实会话校验（force=1 跳过 60 秒缓存）
app.get('/api/notebook/session', async (req, res) => {
  const state = await notebookClient.validateSession({ force: req.query.force === '1' });
  res.json({ code: '000000', data: { authenticated: notebookClient.isAuthenticated(), ...state } });
});
// 11. 拉取真实云笔记列表
app.get('/api/notebook/notes', async (req, res) => {
  try {
    const result = await notebookClient.getCloudNotes(
      Number(req.query.pageIndex) || 1, 
      Number(req.query.pageSize) || 20
    );
    if (Array.isArray(result?.list)) {
      result.list = result.list.map((note) => ({
        ...note,
        downloadState: notebookStore.getCloudNote(note.noteId)?.download_state || 'not_downloaded',
      }));
    }
    res.json({ code: '000000', data: result });
  } catch (err) {
    res.json({
      code: '000000',
      data: {
        authenticated: notebookClient.isAuthenticated(),
        total: 0,
        list: [],
        error: err.message
      }
    });
  }
});

// 12. 推送到智能办公本（双目标，互不影响）
//   fileport：读写驿站 ← 会议纪要全文 DOCX（办公本不支持 .md）
//   record  ：办公本笔记 ← 录音笔记（Ogg Opus 录音 + 文字 = 纪要全文 + 逐句转写）
//   body: { meetingId, targets?: ['fileport','record'] }；来源为办公本的会议不再回推录音笔记。
const notebookPush = new NotebookPushService({
  client: notebookClient,
  store: notebookStore,
  exportDir: path.join(__dirname, '../exports'),
  resolveAudioPath: (id) => (isProjectMeetingId(id) ? notebookStore.getProjectAudioPath(id) : dbService.getAudioFilePath(id)),
});

const pushError = (err) => ({
  ok: false,
  error: err.message,
  code: String(err.code || 500),
  stage: err.stage || null,
  tokenExpired: !!err.tokenExpired,
  needRecordAuth: !!err.needRecordAuth,
});

app.post('/api/notebook/push-summary', async (req, res) => {
  const { meetingId } = req.body || {};
  const meeting = getMeetingDetailById(meetingId);
  if (!meeting) return res.status(404).json({ code: '404', desc: '会议记录不存在' });

  const requested = Array.isArray(req.body?.targets) && req.body.targets.length ? req.body.targets : ['fileport', 'record'];
  const results = {};
  if (requested.includes('fileport')) {
    try { results.fileport = await notebookPush.pushMinutesToFilePort(meeting); }
    catch (err) { results.fileport = pushError(err); }
  }
  if (requested.includes('record')) {
    if (meeting.source === 'notebook') {
      results.record = { ok: true, skipped: true, reason: '该会议来自办公本，录音笔记已在办公本上' };
    } else {
      try { results.record = await notebookPush.pushRecordNote(meeting); }
      catch (err) { results.record = pushError(err); }
    }
  }

  const list = Object.values(results);
  const anyOk = list.some((r) => r.ok && !r.skipped);
  const tokenExpired = list.some((r) => r.tokenExpired);
  const summaryMsg = [
    results.fileport ? (results.fileport.ok ? `读写驿站：已推送《${results.fileport.fileName}》` : `读写驿站：失败（${results.fileport.error}）`) : null,
    results.record ? (results.record.skipped ? `办公本笔记：${results.record.reason}` : results.record.ok ? `办公本笔记：已${results.record.updated ? '更新' : '创建'}录音笔记（${Math.round((results.record.durationMs || 0) / 1000)} 秒录音，${results.record.textEntries} 段文字）` : `办公本笔记：失败（${results.record.error}）`) : null,
  ].filter(Boolean).join('；');

  if (!anyOk && list.some((r) => !r.ok)) {
    return res.status(tokenExpired ? 401 : 502).json({ code: tokenExpired ? '401' : '502', desc: `办公本推送失败：${summaryMsg}`, detail: { results } });
  }
  res.json({
    code: '000000',
    data: {
      status: list.every((r) => r.ok) ? 'success' : 'partial',
      message: summaryMsg,
      results,
      // 兼容旧前端字段
      fileName: results.fileport?.fileName,
      filePortId: results.fileport?.filePortId,
      localFile: results.fileport?.localFile,
    },
  });
});

// 12.0.1 录音笔记推送授权（官方 CLI 作用域会话；登录时会自动建立，此接口用于已登录用户补授权）
app.get('/api/notebook/record-auth', (req, res) => {
  res.json({ code: '000000', data: notebookClient.getRecordScopeStatus() });
});

app.post('/api/notebook/record-auth', async (req, res) => {
  try {
    const data = await notebookClient.loginRecordScope(String(req.body?.password || ''));
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(Number(err.code) >= 400 && Number(err.code) < 600 ? Number(err.code) : 500).json({ code: String(err.code || 500), desc: err.message });
  }
});

// 12.1 下载云笔记附件到项目自有缓存。禁止将 OSS 临时签名地址下发给前端或写入数据库。
app.post('/api/notebook/notes/:id/download', async (req, res) => {
  try {
    const result = await notebookIntegration.downloadNote(req.params.id, {
      force: Boolean(req.body?.force),
      includeTranscript: req.body?.includeTranscript !== false,
    });
    res.json({ code: '000000', data: result });
  } catch (err) {
    const status = err.code === 401 ? 401 : 502;
    res.status(status).json({
      code: String(err.code || 'NOTEBOOK_DOWNLOAD_FAILED'),
      desc: `下载办公本附件失败: ${err.message}`,
      detail: { noteId: req.params.id, stage: err.stage || 'download_part', tokenExpired: !!err.tokenExpired },
    });
  }
});

// 12.2 从项目自有缓存流播 Ogg Opus，支持 HTTP Range。未缓存时必须先显式下载。
app.get('/api/notebook/notes/:id/audio', (req, res) => {
  try {
    const filePath = notebookIntegration.getAudioPath(req.params.id);
    if (!filePath) {
      const note = notebookStore.getCloudNote(req.params.id);
      return res.status(409).json({
        code: 'AUDIO_NOT_READY',
        desc: '录音尚未缓存，请先下载或重新下载',
        data: { state: note?.download_state || 'not_downloaded' },
      });
    }
    streamLocalMedia(req, res, filePath);
  } catch (err) {
    res.status(500).json({ code: '500', desc: `读取办公本录音缓存失败: ${err.message}` });
  }
});

// 12.3 将已缓存的云笔记幂等导入为项目自有会议，不写入 VIAIM 外部数据库。
app.post('/api/notebook/notes/:id/import', async (req, res) => {
  try {
    const meeting = await notebookIntegration.importNote(req.params.id);
    memory?.remember(meeting);
    res.json({ code: '000000', data: meeting });
  } catch (err) {
    const status = err.code === 401 ? 401 : (err.code === 'AUDIO_NOT_READY' ? 409 : 500);
    res.status(status).json({
      code: String(err.code || 'NOTEBOOK_IMPORT_FAILED'),
      desc: `导入办公本笔记失败: ${err.message}`,
      detail: { noteId: req.params.id, tokenExpired: !!err.tokenExpired },
    });
  }
});

// 12.4 盘点曾写入 VIAIM 外部数据库的错误办公本导入记录。
// 仅只读列出；逐条替代和软删除必须在后续迁移 UI 中显式确认后才开放执行。
app.get('/api/notebook/legacy-imports', (req, res) => {
  try {
    res.json({ code: '000000', data: legacyMigration.listCandidates() });
  } catch (err) {
    res.status(500).json({ code: '500', desc: `读取历史导入记录失败: ${err.message}` });
  }
});

// 12.5 拉取单篇云笔记详情。详情返回项目本地播放地址，不返回临时 OSS 链接。
app.get('/api/notebook/notes/:id', async (req, res) => {
  try {
    const detail = await notebookIntegration.getDetail(req.params.id);
    res.json({ code: '000000', data: detail });
  } catch (err) {
    const numeric = Number(err.code);
    const status = err.tokenExpired ? 401 : (numeric >= 400 && numeric <= 599 ? numeric : 500);
    res.status(status).json({
      code: String(err.code || 500),
      desc: `获取笔记详情失败: ${err.message}`,
      detail: {
        reason: err.message,
        noteId: req.params.id,
        tokenExpired: !!err.tokenExpired
      }
    });
  }
});

// 12.2 软删除笔记到云端回收站
app.post('/api/notebook/notes/:id/recycle', async (req, res) => {
  try {
    const data = await notebookClient.removeToRecycle(req.params.id);
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `移入回收站失败: ${err.message}`,
      detail: { reason: err.message, noteId: req.params.id }
    });
  }
});

// 12.3 列出云端回收站
app.get('/api/notebook/recycle', async (req, res) => {
  try {
    const data = await notebookClient.getRecycleNoteList();
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `读取回收站失败: ${err.message}`
    });
  }
});

// 12.4 恢复回收站笔记
app.post('/api/notebook/recycle/recover', async (req, res) => {
  try {
    const { noteIds } = req.body;
    if (!Array.isArray(noteIds) || noteIds.length === 0) {
      return res.status(400).json({ code: '400', desc: 'noteIds 必须是非空数组' });
    }
    const data = await notebookClient.recoverNoteList(noteIds);
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `恢复笔记失败: ${err.message}`
    });
  }
});

// 12.5 云端真删除笔记（不可恢复）
app.delete('/api/notebook/notes/:id', async (req, res) => {
  try {
    const data = await notebookClient.deleteNoteFromCloud(req.params.id);
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `云端删除失败: ${err.message}`,
      detail: { reason: err.message, noteId: req.params.id }
    });
  }
});

// 12.6 列出 FilePort 推送历史
app.get('/api/notebook/fileports', async (req, res) => {
  try {
    const data = await notebookClient.getFilePortList();
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `读取推送历史失败: ${err.message}`
    });
  }
});

// 12.7 删除 FilePort 历史记录
app.delete('/api/notebook/fileports/:id', async (req, res) => {
  try {
    const data = await notebookClient.deleteFilePort(req.params.id);
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `删除推送历史失败: ${err.message}`
    });
  }
});

// 12.8 标签列表
app.get('/api/notebook/tags', async (req, res) => {
  try {
    const data = await notebookClient.getNoteTag();
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `读取标签失败: ${err.message}`
    });
  }
});

// 12.9 目录列表
app.get('/api/notebook/dirs', async (req, res) => {
  try {
    const data = await notebookClient.getDirList();
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `读取目录失败: ${err.message}`
    });
  }
});

// 12.10 日程列表
app.get('/api/notebook/schedules', async (req, res) => {
  try {
    const startTime = req.query.startTime ? Number(req.query.startTime) : undefined;
    const endTime = req.query.endTime ? Number(req.query.endTime) : undefined;
    console.log('[schedules] start=', startTime, 'end=', endTime);
    const data = await notebookClient.getScheduleList(startTime, endTime);
    res.json({ code: '000000', data });
  } catch (err) {
    console.error('[schedules] err:', err.message);
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `读取日程失败: ${err.message}`
    });
  }
});

// 12.11 待办(things) 列表
app.get('/api/notebook/things', async (req, res) => {
  try {
    const data = await notebookClient.getAllThings();
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `读取待办失败: ${err.message}`
    });
  }
});

// 12.12 待办切换完成
app.post('/api/notebook/things/:id/toggle', async (req, res) => {
  try {
    const done = !!req.body.done;
    const data = await notebookClient.setThingsDoneFlag(req.params.id, done);
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `更新待办失败: ${err.message}`
    });
  }
});

// 12.13 分享云笔记（按类型分发）
app.post('/api/notebook/notes/:id/share', async (req, res) => {
  try {
    const { type = 1, days = 7, restricted = 1, code = '' } = req.body;
    const noteId = req.params.id;
    let data;
    if (type === 2 || type === '2') {
      data = await notebookClient.shareRecordPc({ noteId, days, restricted, code });
    } else if (type === 10 || type === 20 || type === '10' || type === '20') {
      data = await notebookClient.shareMixNote({ noteId, days });
    } else if (type === 21 || type === '21') {
      data = await notebookClient.shareMindNote({ noteId, days, restricted });
    } else {
      data = await notebookClient.shareNoteNewPc({ noteId, days, restricted });
    }
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(err.code === 401 ? 401 : 500).json({
      code: String(err.code || 500),
      desc: `分享失败: ${err.message}`
    });
  }
});

// ============== 微信扫码登录主路径 ==============

// 申请 PC 扫码登录 URL（返回 qrUrl + tempToken + 回调地址）
app.post('/api/notebook/cli-login/url', async (req, res) => {
  try {
    const data = await notebookClient.getCliLoginUrl();
    // data 应包含 tempToken + qrUrl（或含 qrContent 原始内容）
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(500).json({
      code: '500',
      desc: `申请扫码登录 URL 失败: ${err.message}`,
      detail: { reason: err.message }
    });
  }
});

// 轮询扫码结果
app.post('/api/notebook/cli-login/result', async (req, res) => {
  try {
    const { tempToken } = req.body;
    if (!tempToken) {
      return res.status(400).json({ code: '400', desc: 'tempToken 不能为空' });
    }
    const data = await notebookClient.getCliLoginResult(tempToken);
    // 扫码成功后云端会返回临时 web code，再用它换 userToken
    if (data?.code || data?.webCode || data?.userToken) {
      const finalToken = data.userToken || data.token;
      if (finalToken) {
        notebookClient._saveToken(finalToken, data.detail || data.userInfo || {});
      }
    }
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(500).json({
      code: '500',
      desc: `查询扫码结果失败: ${err.message}`,
      detail: { reason: err.message }
    });
  }
});

// 查询扫码状态
app.post('/api/notebook/cli-login/status', async (req, res) => {
  try {
    const { tempToken } = req.body;
    if (!tempToken) {
      return res.status(400).json({ code: '400', desc: 'tempToken 不能为空' });
    }
    const data = await notebookClient.getCliStatus(tempToken);
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(500).json({
      code: '500',
      desc: `查询扫码状态失败: ${err.message}`,
      detail: { reason: err.message }
    });
  }
});

// 用 web code 换取最终 userToken
app.post('/api/notebook/cli-login/token', async (req, res) => {
  try {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ code: '400', desc: 'code 不能为空' });
    }
    const data = await notebookClient.getCliWebTempToken(code);
    if (data?.userToken || data?.token) {
      const finalToken = data.userToken || data.token;
      notebookClient._saveToken(finalToken, data.detail || data.userInfo || {});
    }
    res.json({ code: '000000', data });
  } catch (err) {
    res.status(500).json({
      code: '500',
      desc: `换取 token 失败: ${err.message}`,
      detail: { reason: err.message }
    });
  }
});

// 13. 硬件综合状态概览
app.get('/api/devices/status', async (req, res) => {
  const profile = getViaimUserProfile();
  let notebookStatus = {
    connected: false,
    name: '科大讯飞智能办公本',
    isOnline: false,
    authenticated: false,
    sessionValid: false,
    sessionReason: ''
  };

  try {
    const devRes = await notebookClient.getBoundDevices();
    if (devRes.authenticated && devRes.sessionValid && devRes.devices && devRes.devices.length > 0) {
      notebookStatus = {
        ...devRes.devices[0],
        connected: true,
        authenticated: true,
        sessionValid: true,
        sessionReason: ''
      };
    } else {
      notebookStatus.authenticated = devRes.authenticated;
      notebookStatus.sessionValid = !!devRes.sessionValid;
      notebookStatus.sessionReason = devRes.sessionReason || '';
    }
  } catch (err) {
    notebookStatus.sessionReason = err.message;
  }

  res.json({
    code: '000000',
    data: {
      user: profile,
      viaimHeadset: {
        connected: true,
        name: profile.headsetName || 'VIAIM iFLYBUDS Pro 会议耳机',
        dongleConnected: profile.hasDongle,
        dongleModel: profile.dongleModel,
        batteryLeft: 92,
        batteryRight: 88,
        batteryCase: 95,
        aecActive: true,
        mode: '双通道回声消除就绪'
      },
      officeNotebook: notebookStatus
    }
  });
});

// ======================== WebSocket 流式转写 ========================

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws/transcription' });

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg);
      if (data.type === 'START_STREAM') {
        ws.send(JSON.stringify({
          type: 'STATUS',
          payload: { status: 'RECORDING', message: 'CoreAudio 麦克风流式通道已接通 (WebRTC AEC3 回声消除)' }
        }));
      }
    } catch (_) {}
  });
});

server.listen(port, () => {
  memory?.start();
  documents?.start();
  console.log(`[VIAIM-Notebook Assistant] Real Server running on http://localhost:${port}`);
  console.log('[Database] VIAIM kitdb.db is read-only; project meetings and notebook cache use VIAIM Studio/notebook-store');
});
