import React, { useState, useEffect, useRef } from 'react';
import { MemoryHub } from './components/MemoryHub';
import { Header } from './components/Header';
import { MeetingSidebar } from './components/MeetingSidebar';
import { TranscriptionWorkspace } from './components/TranscriptionWorkspace';
import { AiSummaryPanel } from './components/AiSummaryPanel';
import { SuspendQuickWindow } from './components/SuspendQuickWindow';
import { NotebookHubModal } from './components/NotebookHubModal';
import { SettingsModal } from './components/SettingsModal';
import { api, onTokenExpired, MemoryCitation } from './services/api';
import { Meeting, DevicesStatusResponse, OfficeNotebookNote, Sentence } from './types';
import { useToast } from './hooks/useToast';
import { ToastViewport } from './components/Toast';
import { ConfirmHost } from './components/ConfirmHost';

export const App: React.FC = () => {
  const toast = useToast();
  const [memoryOpen,setMemoryOpen] = useState(false);
  const [memorySource,setMemorySource] = useState<MemoryCitation|null>(null);
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [memorySeek, setMemorySeek] = useState<{ meetingId: string; startMs: number; request: number } | null>(null);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [selectedMeeting, setSelectedMeeting] = useState<Meeting | null>(null);
  const [deviceStatus, setDeviceStatus] = useState<DevicesStatusResponse | null>(null);

  // 真实录音状态
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [recordingDuration, setRecordingDuration] = useState<string>('00:00');
  const [latestSentence, setLatestSentence] = useState<string>('');

  // 浮窗与模态框（悬浮录音条默认不自动弹出，由用户点击顶部按钮手动唤起）
  const [isQuickBarOpen, setIsQuickBarOpen] = useState<boolean>(false);
  const [isNotebookHubOpen, setIsNotebookHubOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // 状态指示
  const [isGeneratingAi, setIsGeneratingAi] = useState<boolean>(false);
  const [isTranscribing, setIsTranscribing] = useState<boolean>(false);
  const [autoSummaryEnabled, setAutoSummaryEnabled] = useState<boolean>(true);
  const [isPushing, setIsPushing] = useState<boolean>(false);
  const [pushedMeetingIds, setPushedMeetingIds] = useState<Set<string>>(new Set());
  const [pushedResult, setPushedResult] = useState<any>(null);

  // 录音暂停/继续 + 实时 ASR 上屏流
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const isPausedRef = useRef<boolean>(false);
  const [liveSentences, setLiveSentences] = useState<Partial<Sentence>[]>([]);

  // 硬件与音频引用
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const currentSentencesRef = useRef<Partial<Sentence>[]>([]);
  const speechRecognitionRef = useRef<any>(null);

  // 流式实时转写（ASR stream 模式）
  const liveAsrTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const liveFromMsRef = useRef<number>(0);
  const liveBusyRef = useRef<boolean>(false);
  const liveModeRef = useRef<boolean>(false);

  // 初始化加载真实数据
  useEffect(() => {
    loadInitialData();
    const interval = setInterval(loadDevices, 8000);
    return () => clearInterval(interval);
  }, []);

  // 读取「录制结束后自动提炼」开关状态
  useEffect(() => {
    api.getLlmConfig()
      .then((cfg) => setAutoSummaryEnabled(cfg.autoSummary))
      .catch(() => {});
  }, []);

  // 监听 token 失效事件（任意云端请求 detail.tokenExpired=true 时触发）
  useEffect(() => {
    const off = onTokenExpired(() => {
      toast.warning('请前往「办公本工作中心」重新登录讯飞账号。', { title: '登录凭据已失效', duration: 6000 });
      api.logoutNotebook().catch(() => {});
    });
    return () => { off(); };
  }, []);

  const loadInitialData = async () => {
    try {
      const [meetingsData, devicesData] = await Promise.all([
        api.getMeetings(),
        api.getDevicesStatus()
      ]);
      setMeetings(meetingsData);
      setDeviceStatus(devicesData);

      if (meetingsData.length > 0) {
        const initialId = meetingsData[0].id;
        setSelectedMeetingId(initialId);
        loadMeetingDetail(initialId);
      }
    } catch (err) {
      console.error('初始化真实数据失败:', err);
    }
  };

  const loadDevices = async () => {
    try {
      const data = await api.getDevicesStatus();
      setDeviceStatus(data);
    } catch (_) {}
  };

  const loadMeetingDetail = async (id: string) => {
    try {
      const detail = await api.getMeetingDetail(id);
      setSelectedMeeting(detail);
    } catch (err) {
      console.error('加载会议详情失败:', err);
    }
  };

  const handleSelectMeeting = (id: string) => {
    setSelectedMeetingId(id);
    loadMeetingDetail(id);
  };

  // 真实录音计时（暂停时不累计）
  useEffect(() => {
    if (isRecording) {
      timerRef.current = setInterval(() => {
        if (isPausedRef.current) return;
        setRecordingSeconds((prev) => {
          const next = prev + 1;
          const mins = Math.floor(next / 60).toString().padStart(2, '0');
          const secs = (next % 60).toString().padStart(2, '0');
          setRecordingDuration(`${mins}:${secs}`);
          return next;
        });
      }, 1000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isRecording]);

  // 流式增量转写：把截至当前的完整录音发给后端，只识别新增尾部并实时上屏
  const liveTranscribeTick = async () => {
    if (liveBusyRef.current || isPausedRef.current || !audioChunksRef.current.length) return;
    liveBusyRef.current = true;
    try {
      const blob = new Blob(audioChunksRef.current, { type: 'audio/webm; codecs=opus' });
      const base64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      const result = await api.asrLiveTail(base64, liveFromMsRef.current);
      for (const seg of result.segments || []) {
        const mins = Math.floor(seg.startMs / 60000).toString().padStart(2, '0');
        const secs = Math.floor((seg.startMs % 60000) / 1000).toString().padStart(2, '0');
        const item: Partial<Sentence> = {
          id: `s_live_${seg.startMs}`,
          speaker: '我',
          time: `${mins}:${secs}`,
          startTimeMs: seg.startMs,
          endTimeMs: seg.endMs,
          text: seg.text,
        };
        currentSentencesRef.current.push(item);
        setLiveSentences((prev) => [...prev, item]);
        setLatestSentence(`[我]: ${seg.text}`);
      }
      liveFromMsRef.current = result.nextFromMs ?? liveFromMsRef.current;
    } catch (err: any) {
      console.warn('流式转写分段失败（下轮重试）:', err?.message);
    } finally {
      liveBusyRef.current = false;
    }
  };

  const stopLiveTranscription = () => {
    if (liveAsrTimerRef.current) {
      clearInterval(liveAsrTimerRef.current);
      liveAsrTimerRef.current = null;
    }
  };

  // 启动真实硬件麦克风录制 (Mac CoreAudio + Web Audio + 真实转写)
  const handleStartRealRecording = async () => {
    try {
      audioChunksRef.current = [];
      currentSentencesRef.current = [];
      setLiveSentences([]);
      isPausedRef.current = false;
      setIsPaused(false);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 2
        } 
      });

      // 连接 Web Audio Analyser
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      // 启动 MediaRecorder
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };
      mediaRecorder.start(1000);
      mediaRecorderRef.current = mediaRecorder;

      // 初始化语音识别：优先用户配置的「流式实时转写」，其次尝试 Web Speech API（Electron 内通常不可用）
      liveModeRef.current = false;
      liveFromMsRef.current = 0;
      try {
        const cfg = await api.getLlmConfig();
        if (cfg.asr?.mode === 'stream') {
          liveModeRef.current = true;
          toast.info('流式实时转写已开启（每 30 秒增量识别）', { title: '语音转写' });
          liveAsrTimerRef.current = setInterval(liveTranscribeTick, 30000);
        }
      } catch (_) { /* 配置读取失败时按录音后转写处理 */ }

      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (!liveModeRef.current && SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'zh-CN';

        recognition.onresult = (event: any) => {
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript;
            if (event.results[i].isFinal) {
              const nowSec = recordingSeconds;
              const mins = Math.floor(nowSec / 60).toString().padStart(2, '0');
              const secs = (nowSec % 60).toString().padStart(2, '0');
              const sItem: Partial<Sentence> = {
                id: `s_real_${Date.now()}`,
                speaker: deviceStatus?.user?.userName || '我',
                time: `${mins}:${secs}`,
                startTimeMs: nowSec * 1000,
                text: transcript
              };
              currentSentencesRef.current.push(sItem);
              setLiveSentences((prev) => [...prev, sItem]);
              setLatestSentence(`[${sItem.speaker}]: ${transcript}`);
            } else {
              setLatestSentence(transcript);
            }
          }
        };

        recognition.onerror = (e: any) => {
          console.warn('SpeechRecognition status:', e.error);
        };

        recognition.start();
        speechRecognitionRef.current = recognition;
      }

      setIsRecording(true);
      setRecordingSeconds(0);
      setRecordingDuration('00:00');
      setLatestSentence('麦克风双通道回声消除录制中...');
    } catch (err: any) {
      toast.error(
        `麦克风访问被拒绝。请在「系统设置 → 隐私与安全性 → 麦克风」允许 OpeniFLYTEK。\n详情: ${err.message || '未知错误'}`,
        { title: '麦克风不可用', duration: 8000 }
      );
    }
  };

  // 结束真实录音并保存写入数据库
  const handleStopRealRecording = async () => {
    setIsRecording(false);
    isPausedRef.current = false;
    setIsPaused(false);
    setLatestSentence('');

    // 停止流式转写定时器，并补齐最后一段
    const wasLiveMode = liveModeRef.current;
    stopLiveTranscription();
    if (wasLiveMode) {
      await liveTranscribeTick().catch(() => {});
      liveModeRef.current = false;
    }

    if (speechRecognitionRef.current) {
      try { speechRecognitionRef.current.stop(); } catch (_) {}
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
    }

    // 等待最后的数据块
    await new Promise((r) => setTimeout(r, 600));

    try {
      const audioBlob = new Blob(audioChunksRef.current, {
        type: mediaRecorderRef.current?.mimeType || 'audio/webm; codecs=opus'
      });
      const reader = new FileReader();
      
      reader.onloadend = async () => {
        const audioBase64 = reader.result as string;
        const now = new Date();
        const title = `${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} 会议记录_${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const created = await api.saveRecordedMeeting({
          title,
          durationMs: recordingSeconds * 1000,
          sentences: currentSentencesRef.current.length > 0 ? currentSentencesRef.current : [
            {
              speaker: deviceStatus?.user?.userName || '我',
              time: '00:01',
              startTimeMs: 1000,
                text: '录音已完成并保存至 OpeniFLYTEK 项目自有存储。'
            }
          ],
          audioBase64
        });

        // 重新拉取会议列表并定位到新录制的会议
        const updatedList = await api.getMeetings();
        setMeetings(updatedList);
        setSelectedMeetingId(created.id);
        setSelectedMeeting(created);

        // 流式模式已实时产出转写时无需再整场转写；否则录音结束后立即离线转写
        const hasRealTranscript = currentSentencesRef.current.some(
          (s) => s.text && !/📌|重点标记|标记点/.test(s.text) && s.text !== '录音已完成并保存至 OpeniFLYTEK 项目自有存储。'
        );
        if (!hasRealTranscript) {
          await transcribeAndRefresh(created.id, { silentOnMissingKey: true });
        }
      };

      reader.readAsDataURL(audioBlob);
    } catch (err: any) {
      console.error('保存录音失败:', err);
    }
  };

  // 切换录音
  const handleToggleRecord = async () => {
    if (isRecording) {
      await handleStopRealRecording();
    } else {
      await handleStartRealRecording();
    }
  };

  // 暂停 / 继续录音（MediaRecorder 原生暂停，计时与流式转写同步停摆）
  const handlePauseResume = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    if (isPausedRef.current) {
      try { recorder.resume(); } catch (_) {}
      isPausedRef.current = false;
      setIsPaused(false);
      setLatestSentence('录音已继续…');
    } else {
      try { recorder.pause(); } catch (_) {}
      isPausedRef.current = true;
      setIsPaused(true);
      setLatestSentence('');
    }
  };

  // 结束并立即提炼（受「录制结束后自动提炼」开关控制）
  const handleFinishAndSummarize = async () => {
    if (!isRecording) return;
    await handleStopRealRecording();

    let auto = autoSummaryEnabled;
    try {
      const cfg = await api.getLlmConfig();
      auto = cfg.autoSummary;
      setAutoSummaryEnabled(cfg.autoSummary);
    } catch (_) {
      /* 读取失败时沿用已有开关状态 */
    }
    if (auto) setTimeout(() => handleGenerateAiSummary(), 800);
  };

  // 离线转写当前会议音频（智谱 glm-asr），成功后刷新转写列表
  const transcribeAndRefresh = async (meetingId: string, options: { silentOnMissingKey?: boolean } = {}) => {
    setIsTranscribing(true);
    try {
      toast.info('正在对录音进行语音转写…', { title: '音频转写' });
      const updated = await api.transcribeMeeting(meetingId);
      setSelectedMeeting((prev) => (prev && prev.id === meetingId ? updated : prev));
      setMeetings((prev) => prev.map((m) => (m.id === meetingId ? { ...m, sentenceCount: updated.sentences?.length || 0 } : m)));
      toast.success(`转写完成，共识别 ${updated.sentences?.length || 0} 条发言`, { title: '音频转写' });
      return updated;
    } catch (err: any) {
      const msg = err?.message || '音频转写失败';
      const silent = options.silentOnMissingKey && /GLM API Key/.test(msg);
      if (!silent) toast.error(msg, { title: '音频转写失败', duration: 8000 });
      return null;
    } finally {
      setIsTranscribing(false);
    }
  };

  // 触发 AI 纪要生成（options.force=true 时忽略缓存，重新调用大模型提炼）
  const handleGenerateAiSummary = async (options: { force?: boolean } = {}) => {
    if (!selectedMeetingId) return;
    const meetingId = selectedMeetingId;
    setIsGeneratingAi(true);
    try {
      const summary = await api.generateAiSummary(meetingId, { force: options.force });
      setSelectedMeeting((prev) => (prev && prev.id === meetingId ? { ...prev, aiSummary: summary } : prev));
      setMeetings((prev) => prev.map((m) => (m.id === meetingId ? { ...m, aiSummary: summary, hasSummary: true } : m)));
      toast.success(options.force ? '已重新提炼 AI 纪要' : 'AI 纪要已生成', { title: 'AI 会议大脑' });
    } catch (err: any) {
      if (err?.code === 'LLM_NOT_CONFIGURED') {
        toast.warning(err?.message || '请先在设置中配置大模型引擎', {
          title: '未配置大模型',
          duration: 8000,
          action: { label: '前往设置', run: () => setIsSettingsOpen(true) }
        });
      } else {
        toast.error(err?.message || '提炼失败，请稍后重试', { title: 'AI 纪要提炼失败', duration: 8000 });
      }
    } finally {
      setIsGeneratingAi(false);
    }
  };

  // 切换真实待办事项
  const handleToggleTodo = async (todoId: string) => {
    if (!selectedMeetingId) return;
    try {
      const updatedTodos = await api.toggleTodo(selectedMeetingId, todoId);
      if (selectedMeeting && selectedMeeting.aiSummary) {
        setSelectedMeeting({
          ...selectedMeeting,
          aiSummary: {
            ...selectedMeeting.aiSummary,
            todos: updatedTodos
          }
        });
      }
    } catch (err) {
      console.error('更新待办状态失败:', err);
    }
  };

  // 推送到讯飞智能办公本：读写驿站（纪要全文 DOCX）+ 办公本笔记（录音笔记），两个目标独立返回结果
  // meetingId 可选：左侧栏每条录音的小图标会指定目标会议
  const handlePushToNotebook = async (meetingId?: string) => {
    const targetId = meetingId || selectedMeetingId;
    if (!targetId) return;
    setIsPushing(true);
    setPushedResult(null);
    try {
      const result = await api.pushSummaryToNotebook(targetId);
      setPushedResult(result);
      setPushedMeetingIds((prev) => new Set(prev).add(targetId));
      if (result.status === 'partial') {
        toast.error(result.message, { title: '办公本推送部分完成', duration: 10000 });
      } else if (meetingId) {
        toast.success('已推送到讯飞智能办公本', { title: '办公本推送' });
      }
    } catch (err: any) {
      setPushedResult({
        status: 'error',
        message: err?.message || '网络异常',
        results: err?.results || null
      });
      toast.error(
        err?.message || '推送到智能办公本失败：网络异常',
        { title: '办公本推送失败', duration: 10000 }
      );
    } finally {
      setIsPushing(false);
    }
  };

  // 修改会议标题
  const handleUpdateTitle = (newTitle: string) => {
    if (!selectedMeetingId) return;
    setSelectedMeeting((prev) => prev ? { ...prev, title: newTitle } : null);
    setMeetings((prev) => prev.map((m) => m.id === selectedMeetingId ? { ...m, title: newTitle } : m));
  };

  // 修改转写句子
  const handleSentenceEdit = (sentenceId: string, newText: string) => {
    if (!selectedMeetingId || !selectedMeeting) return;
    const updated = selectedMeeting.sentences.map((s) => s.id === sentenceId ? { ...s, text: newText } : s);
    setSelectedMeeting({ ...selectedMeeting, sentences: updated });
  };

  // 本地删除会议
  const handleDeleteMeeting = async (id: string) => {
    try {
      await api.deleteMeeting(id);
      const updatedList = await api.getMeetings();
      setMeetings(updatedList);
      if (selectedMeetingId === id) {
        const next = updatedList[0] || null;
        setSelectedMeetingId(next ? next.id : null);
        setSelectedMeeting(next);
      }
    } catch (err: any) {
      toast.error(`删除失败: ${err?.message || '数据库异常'}`, { title: '本地删除失败', duration: 5000 });
    }
  };

  // 从办公本云端导入笔记：先下载至项目自有缓存，校验通过后按 noteId 幂等写入项目会议库。
  const handleImportNoteAsMeeting = async (note: OfficeNotebookNote) => {
    try {
      await api.downloadNotebookNote(note.noteId, { includeTranscript: true });
      const created = await api.importNotebookNote(note.noteId);

      const updatedList = await api.getMeetings();
      setMeetings(updatedList);
      setSelectedMeetingId(created.id);
      setSelectedMeeting(created);
    } catch (e) {
      console.error('导入办公本笔记失败:', e);
      const stage = (e as any)?.detail?.stage;
      toast.error(`导入失败${stage ? `（${stage}）` : ''}: ${(e as any)?.message || '网络异常'}`, { title: '办公本导入失败', duration: 7000 });
      throw e;
    }
  };

  const openMemorySource = async (citation:MemoryCitation) => {
    const evidence = await api.memoryEvidence(citation);
    if(evidence.sourceType==='document') {setMemorySource(evidence);setMemoryOpen(true);return;}
    if(isRecording)throw new Error('正在录音，结束录音后可定位播放');
    const detail=await api.getMeetingDetail(evidence.meetingId);
    if(!detail)throw new Error('来源会议已不可读取');
    setMemoryOpen(false);setSelectedMeetingId(detail.id);setSelectedMeeting(detail);
    setMemorySeek({meetingId:detail.id,startMs:evidence.startMs,request:Date.now()});
  };
  // 左栏「记忆与资料」标签：打开某份资料的解读详情（复用 MemoryHub 弹窗）
  const openDocument = (docId: string) => {
    setMemorySource({ sourceType: 'document', meetingId: docId } as MemoryCitation);
    setMemoryOpen(true);
  };
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-viaim-bg text-viaim-textMain select-none">
      {/* 顶部主导航栏（符合 Mac 沉浸式风格与原生交通灯对齐） */}
      <Header deviceStatus={deviceStatus} onOpenMemory={()=>{setMemorySource(null);setMemoryOpen(true);}} />
      <MemoryHub open={memoryOpen} onClose={()=>setMemoryOpen(false)} source={memorySource} onOpenMemory={openMemorySource} />

      {/* 桌面端三栏工作台主体 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左栏：真实会议记录侧边栏 (280px) */}
        <MeetingSidebar
          meetings={meetings}
          selectedMeetingId={selectedMeetingId}
          onSelectMeeting={handleSelectMeeting}
          pushedMeetingIds={pushedMeetingIds}
          onDeleteMeeting={handleDeleteMeeting}
          onPushToNotebook={handlePushToNotebook}
          isPushing={isPushing}
          deviceStatus={deviceStatus}
          onOpenNotebookHub={() => setIsNotebookHubOpen(true)}
          onOpenSettings={() => setIsSettingsOpen(true)}
          isRecording={isRecording}
          onToggleRecord={handleToggleRecord}
          onOpenDocument={openDocument}
          onOpenMemory={openMemorySource}
        />

        {/* 中栏：转写编辑器与音频工作台 (弹性伸缩) */}
        <div className="flex-1 overflow-hidden flex flex-col border-r border-viaim-border">
          <TranscriptionWorkspace
            meeting={isRecording ? null : selectedMeeting}
            memorySeek={memorySeek}
            onUpdateTitle={handleUpdateTitle}
            onSentenceEdit={handleSentenceEdit}
            isRecording={isRecording}
            recordingDuration={recordingDuration}
            isPaused={isPaused}
            onPauseResume={handlePauseResume}
            onStopRecording={handleToggleRecord}
            liveSentences={liveSentences}
            latestSentence={latestSentence}
          />
        </div>

        {/* 右栏：AI 会议大脑与智能办公本推屏面板 (392px，完全匹配 setting.ini 布局) */}
        <div className="w-[392px] shrink-0 h-full overflow-hidden bg-slate-950/40">
          <AiSummaryPanel
            meeting={selectedMeeting}
            meetings={meetings}
            onOpenMemory={openMemorySource}
            onGenerateAiSummary={handleGenerateAiSummary}
            isGeneratingAi={isGeneratingAi}
            onToggleTodo={handleToggleTodo}
            onPushToNotebook={handlePushToNotebook}
            isPushing={isPushing}
            isPushed={selectedMeeting ? pushedMeetingIds.has(selectedMeeting.id) : false}
            pushedResult={pushedResult}
            notebookDevice={deviceStatus?.officeNotebook || null}
            isQuickBarOpen={isQuickBarOpen}
            onToggleQuickBar={() => setIsQuickBarOpen(!isQuickBarOpen)}
          />
        </div>
      </div>

      {/* VIAIM 特色：独立桌面悬浮快速录音胶囊 (SuspendQuickWindow) */}
      <SuspendQuickWindow
        isOpen={isQuickBarOpen}
        onClose={() => setIsQuickBarOpen(false)}
        isRecording={isRecording}
        onToggleRecord={handleToggleRecord}
        recordingDuration={recordingDuration}
        latestSentence={latestSentence}
        onAddBookmark={() => {
          if (isRecording) {
            const bmItem: Partial<Sentence> = {
              id: `bm_${Date.now()}`,
              speaker: '重点打标',
              time: recordingDuration,
              startTimeMs: recordingSeconds * 1000,
              text: `📌 重点标记点 [${recordingDuration}]`
            };
            currentSentencesRef.current.push(bmItem);
            setLiveSentences((prev) => [...prev, bmItem]);
            setLatestSentence(`📌 已在 ${recordingDuration} 添加重点标记`);
          }
        }}
        onFinishAndSummarize={handleFinishAndSummarize}
        onRestoreMainWindow={() => setIsQuickBarOpen(false)}
      />

      {/* 科大讯飞智能办公本云端互联工作台 */}
      <NotebookHubModal
        isOpen={isNotebookHubOpen}
        onClose={() => setIsNotebookHubOpen(false)}
        onImportNoteAsMeeting={handleImportNoteAsMeeting}
      />

      {/* 硬件与算法设置 */}
      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
      />

      {/* 全局 Toast 通知面板（viaind 主题，替代 window.alert） */}
      <ToastViewport />

      {/* 全局 ConfirmModal 渲染器（接 useConfirm() 的 Promise） */}
      <ConfirmHost />
    </div>
  );
};
