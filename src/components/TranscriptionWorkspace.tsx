import React, { useState, useRef, useEffect } from 'react';
import {
  Play,
  Pause,
  Square,
  Radio,
  Mic,
  Sparkles,
  Edit3,
  Check,
  User,
  FileText,
  ScrollText,
  AudioLines
} from 'lucide-react';
import { Meeting, Sentence } from '../types';

interface TranscriptionWorkspaceProps {
  meeting: Meeting | null;
  memorySeek?: { meetingId: string; startMs: number; request: number } | null;
  onUpdateTitle: (newTitle: string) => void;
  onSentenceEdit: (sentenceId: string, newText: string) => void;
  isRecording: boolean;
  recordingDuration: string;
  isPaused: boolean;
  onPauseResume: () => void;
  onStopRecording: () => void;
  liveSentences: Partial<Sentence>[];
  latestSentence: string;
}

export const TranscriptionWorkspace: React.FC<TranscriptionWorkspaceProps> = ({
  meeting,
  memorySeek,
  onUpdateTitle,
  onSentenceEdit,
  isRecording,
  recordingDuration,
  isPaused,
  onPauseResume,
  onStopRecording,
  liveSentences,
  latestSentence
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [editingSentenceId, setEditingSentenceId] = useState<string | null>(null);
  const [sentenceInput, setSentenceInput] = useState('');
  const [lowerTab, setLowerTab] = useState<'transcript' | 'summary'>('transcript');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const liveScrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (meeting) {
      setTitleInput(meeting.title);
      setIsPlaying(false);
      setAudioError(null);
      setLowerTab('transcript');
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }
    }
  }, [meeting?.id]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !memorySeek || memorySeek.meetingId !== meeting?.id || isRecording) return;
    const seek = () => {
      audio.currentTime = Math.max(0, memorySeek.startMs / 1000);
      audio.play().then(() => setIsPlaying(true)).catch(() => setAudioError('已定位到引用位置，请点击播放'));
    };
    if (audio.readyState >= 1) seek();
    else audio.addEventListener('loadedmetadata', seek, { once: true });
    return () => audio.removeEventListener('loadedmetadata', seek);
  }, [memorySeek, meeting?.id, isRecording]);

  const handleAudioTimeUpdate = () => {
    if (audioRef.current && !isNaN(audioRef.current.duration) && audioRef.current.duration > 0) {
      // 仅同步播放状态；时间显示控件已按需求隐藏
    }
  };

  const handleTogglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => {
        setIsPlaying(true);
      }).catch(err => {
        console.warn('播放录音失败:', err);
      });
    }
  };

  const handleSeek = (newTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, newTime);
      if (!isPlaying) {
        audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
      }
    }
  };

  // 实时 ASR 视图自动滚动到底部
  useEffect(() => {
    if (isRecording && liveScrollRef.current) {
      liveScrollRef.current.scrollTop = liveScrollRef.current.scrollHeight;
    }
  }, [liveSentences.length, latestSentence, isRecording]);

  if (!meeting && !isRecording) {
    return (
      <main className="flex-1 h-full flex flex-col items-center justify-center text-viaim-textDim">
        <Sparkles className="w-12 h-12 stroke-1 mb-3 opacity-40 text-viaim-primary" />
        <p className="text-sm">请在左侧选择一个真实会议记录，或点击左栏「新建会议录制」开始录音</p>
      </main>
    );
  }

  const getSpeakerColor = (speaker: string) => {
    if (speaker.includes('1') || speaker.includes('姚') || speaker.includes('我')) {
      return 'bg-indigo-500/20 text-indigo-300 border-indigo-500/40';
    }
    if (speaker.includes('2') || speaker.includes('李')) {
      return 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40';
    }
    if (speaker.includes('3') || speaker.includes('王')) {
      return 'bg-amber-500/20 text-amber-600 border-amber-500/40';
    }
    return 'bg-purple-500/20 text-purple-300 border-purple-500/40';
  };

  const audioSrc = meeting?.audioUrl
    ? (/^https?:\/\//i.test(meeting.audioUrl) ? meeting.audioUrl : `http://localhost:3800${meeting.audioUrl}`)
    : null;

  const summary = meeting?.aiSummary;

  // ==================== 录制中：实时 ASR 视图 ====================
  const liveView = (
    <div ref={liveScrollRef} className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
      {liveSentences.length === 0 && !latestSentence && (
        <div className="h-64 flex flex-col items-center justify-center text-viaim-textDim text-xs">
          <AudioLines className="w-8 h-8 stroke-1 mb-2 text-viaim-primary animate-pulse" />
          <p>正在录制，说话内容将经实时 ASR 流式上屏…</p>
          <p className="mt-1 text-[11px] opacity-70">（可在「设置 → 语音转写 ASR」选择流式/本地/在线模式）</p>
        </div>
      )}
      {liveSentences.map((sentence) => {
        const speakerColor = getSpeakerColor(sentence.speaker);
        return (
          <div key={sentence.id} className="flex items-start gap-3.5">
            <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${speakerColor}`}>
              {sentence.speaker.substring(0, 2)}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold text-viaim-textMain">{sentence.speaker}</span>
                <span className="text-[11px] font-mono text-viaim-textDim">{sentence.time}</span>
              </div>
              <p className="text-xs text-slate-200 leading-relaxed">{sentence.text}</p>
            </div>
          </div>
        );
      })}
      {latestSentence && (
        <div className="flex items-start gap-3.5 opacity-70">
          <div className="w-8 h-8 rounded-full border border-slate-700 bg-slate-800/60 flex items-center justify-center text-xs font-bold shrink-0 text-slate-400">
            <Mic className="w-3.5 h-3.5" />
          </div>
          <div className="flex-1">
            <p className="text-xs text-slate-300 leading-relaxed">
              {latestSentence}
              <span className="inline-block w-1.5 h-3.5 ml-1 bg-viaim-primary animate-pulse align-middle rounded-sm" />
            </p>
          </div>
        </div>
      )}
    </div>
  );

  // ==================== 转写内容标签页 ====================
  const transcriptView = (
    <>
      {audioError && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-600 shrink-0">
          音频不可用：{audioError}
        </div>
      )}
      {!audioSrc && !audioError && (
        <div className="mx-5 mt-3 px-3 py-2 rounded-lg bg-viaim-card border border-viaim-border text-[11px] text-viaim-textDim shrink-0">
          {meeting?.source === 'viaim' && meeting?.title.startsWith('[办公本]')
            ? '这是旧版错误导入的记录，未保存录音。请在「办公本中心」重新「下载并导入」该笔记。'
            : '该会议没有关联录音文件。'}
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar">
        {meeting?.sentences && meeting.sentences.length > 0 ? (
          meeting.sentences.map((sentence) => {
            const isEditing = editingSentenceId === sentence.id;
            const speakerColor = getSpeakerColor(sentence.speaker);

            return (
              <div
                key={sentence.id}
                className="flex items-start gap-3.5 group hover:bg-slate-900/40 p-2.5 rounded-xl transition-colors"
              >
                <div className={`w-8 h-8 rounded-full border flex items-center justify-center text-xs font-bold shrink-0 ${speakerColor}`}>
                  {sentence.speaker.substring(0, 2)}
                </div>

                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-viaim-textMain">
                      {sentence.speaker}
                    </span>
                    <button
                      onClick={() => {
                        if (sentence.startTimeMs !== undefined) handleSeek(sentence.startTimeMs / 1000);
                      }}
                      className="text-[11px] font-mono text-viaim-textDim hover:text-viaim-primary transition-colors cursor-pointer"
                      title="点击跳转播放此处音频"
                    >
                      {sentence.time}
                    </button>
                  </div>

                  {isEditing ? (
                    <div className="flex items-center gap-2 mt-1">
                      <input
                        type="text"
                        value={sentenceInput}
                        onChange={(e) => setSentenceInput(e.target.value)}
                        className="flex-1 bg-slate-900 border border-viaim-primary rounded px-2.5 py-1 text-xs text-viaim-textMain focus:outline-none"
                        autoFocus
                      />
                      <button
                        onClick={() => {
                          onSentenceEdit(sentence.id, sentenceInput);
                          setEditingSentenceId(null);
                        }}
                        className="p-1 rounded bg-viaim-primary text-white"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-200 leading-relaxed group/p flex items-start justify-between">
                      <span>{sentence.text}</span>
                      <button
                        onClick={() => {
                          setEditingSentenceId(sentence.id);
                          setSentenceInput(sentence.text);
                        }}
                        className="opacity-0 group-hover/p:opacity-100 p-0.5 text-viaim-textDim hover:text-viaim-textMain transition-opacity ml-2 shrink-0"
                        title="编辑文字"
                      >
                        <Edit3 className="w-3 h-3" />
                      </button>
                    </p>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="h-64 flex flex-col items-center justify-center text-viaim-textDim text-xs">
            <Mic className="w-8 h-8 stroke-1 mb-2 opacity-40 text-viaim-primary animate-pulse" />
            <p>该会议暂无句子记录，可点击文件名前的播放按钮试听，或使用右栏 AI 会议大脑重新提炼。</p>
          </div>
        )}
      </div>
    </>
  );

  // ==================== 会议纪要标签页 ====================
  const summaryView = (
    <div className="flex-1 overflow-y-auto p-5 space-y-4 custom-scrollbar select-text">
      {summary?.generated || summary?.abstract || (summary?.topics && summary.topics.length) ? (
        <>
          {summary.title && (
            <h2 className="text-sm font-bold text-viaim-textMain">{summary.title}</h2>
          )}
          <section>
            <h3 className="text-[11px] font-bold text-viaim-textDim uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-viaim-primary" /> 核心摘要
            </h3>
            <p className="text-xs text-slate-200 leading-relaxed bg-viaim-card/60 border border-viaim-border rounded-xl p-3">
              {summary.abstract}
            </p>
          </section>
          {summary.topics && summary.topics.length > 0 && (
            <section>
              <h3 className="text-[11px] font-bold text-viaim-textDim uppercase tracking-wider mb-1.5">主要议题</h3>
              <ul className="space-y-1.5">
                {summary.topics.map((t, i) => (
                  <li key={i} className="text-xs text-slate-200 leading-relaxed flex gap-2">
                    <span className="text-viaim-primary font-bold shrink-0">{i + 1}.</span>
                    <span>{t}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {summary.todos && summary.todos.length > 0 && (
            <section>
              <h3 className="text-[11px] font-bold text-viaim-textDim uppercase tracking-wider mb-1.5">待办事项</h3>
              <ul className="space-y-1.5">
                {summary.todos.map((t) => (
                  <li key={t.id} className="text-xs text-slate-200 leading-relaxed flex gap-2">
                    <span className={`shrink-0 ${t.done ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {t.done ? '✓' : '○'}
                    </span>
                    <span>
                      {t.task}
                      {t.owner ? <span className="text-viaim-textDim">（{t.owner}）</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {summary.summaryFull && (
            <section>
              <h3 className="text-[11px] font-bold text-viaim-textDim uppercase tracking-wider mb-1.5">完整纪要</h3>
              <p className="text-xs text-slate-200 leading-relaxed whitespace-pre-wrap bg-viaim-card/60 border border-viaim-border rounded-xl p-3">
                {summary.summaryFull}
              </p>
            </section>
          )}
        </>
      ) : (
        <div className="h-64 flex flex-col items-center justify-center text-viaim-textDim text-xs">
          <ScrollText className="w-8 h-8 stroke-1 mb-2 opacity-40 text-viaim-primary" />
          <p>该会议尚未生成 AI 纪要</p>
          <p className="mt-1 text-[11px] opacity-70">可在右侧「AI 会议大脑」中一键提炼完整会议纪要</p>
        </div>
      )}
    </div>
  );

  return (
    <main className="flex-1 h-full flex flex-col overflow-hidden bg-viaim-bg select-text">
      {/* 隐藏的真实原生 HTML5 Audio 元素，连接后端本地音频流 */}
      {!isRecording && audioSrc && (
        <audio
          ref={audioRef}
          src={audioSrc}
          onTimeUpdate={handleAudioTimeUpdate}
          onEnded={() => setIsPlaying(false)}
          onError={() => {
            const code = audioRef.current?.error?.code;
            const message = code === 4
              ? '浏览器不支持该音频格式或缓存响应无效'
              : code === 3 ? '音频解码失败，请重新下载缓存'
                : code === 2 ? '读取音频缓存失败，请检查下载状态'
                  : '音频缓存不可用，请重新下载';
            setAudioError(message);
            setIsPlaying(false);
          }}
        />
      )}

      {/* 顶部标题与播放/录制控制栏（与左栏「新建会议录制」按钮同行对齐、等高 h-9） */}
      <div className="p-4 border-b border-viaim-border bg-viaim-card/40 flex items-center justify-between shrink-0">
        <div className="flex-1 mr-4 flex items-center gap-3 min-w-0">
          {/* 播放按钮：置于文件名前 */}
          {!isRecording && (
            <button
              onClick={handleTogglePlay}
              disabled={!audioSrc}
              className={`w-9 h-9 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                audioSrc
                  ? 'border-viaim-border bg-viaim-card text-viaim-textMain hover:text-indigo-300 hover:border-viaim-primary/60 hover:bg-viaim-primary/10 cursor-pointer'
                  : 'border-viaim-border/50 bg-viaim-card/50 text-viaim-textDim cursor-not-allowed opacity-50'
              }`}
              title={audioSrc ? (isPlaying ? '暂停播放' : '播放录音') : '该会议暂无可播放录音'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
            </button>
          )}
          <div className="min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                className="bg-slate-900 border border-viaim-primary rounded px-2.5 py-1 text-sm font-semibold text-viaim-textMain focus:outline-none w-full max-w-lg"
                autoFocus
              />
              <button
                onClick={() => {
                  onUpdateTitle(titleInput);
                  setEditingTitle(false);
                }}
                className="p-1 rounded bg-viaim-primary text-white hover:bg-indigo-600 transition-colors"
              >
                <Check className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h1 className="text-base font-bold text-viaim-textMain tracking-wide line-clamp-1">
                {isRecording ? '正在录制的新会议…' : meeting?.title}
              </h1>
              {!isRecording && meeting && (
                <button
                  onClick={() => setEditingTitle(true)}
                  className="opacity-0 group-hover:opacity-100 p-1 text-viaim-textDim hover:text-viaim-textMain transition-opacity"
                  title="修改标题"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 mt-1 text-xs text-viaim-textDim">
            {isRecording ? (
              <>
                <span>{new Date().toLocaleString('zh-CN')}</span>
                <span>·</span>
                <span>{liveSentences.length} 句实录</span>
              </>
            ) : (
              meeting && (
                <>
                  <span>{new Date(meeting.createdAt).toLocaleString('zh-CN')}</span>
                  <span>·</span>
                  <span>时长 {meeting.duration}</span>
                  <span>·</span>
                  <span className="text-viaim-cyan">{meeting.audioSource}</span>
                  <span>·</span>
                  <span>{meeting.sentences?.length || 0} 句实录</span>
                </>
              )
            )}
          </div>
          </div>
        </div>

        {/* 右侧控制区：录制中=录音状态 + 暂停/继续/结束（非录制时右侧无控件） */}
        <div className="flex items-center gap-2 shrink-0">
          {isRecording ? (
            <>
              <div className="h-9 px-3 rounded-lg bg-red-500/15 border border-red-500/50 flex items-center gap-2" title="当前正在录音">
                <Radio className={`w-3.5 h-3.5 text-red-500 ${isPaused ? '' : 'animate-pulse'}`} />
                <span className="text-xs font-bold text-red-500">{isPaused ? '已暂停' : '录制中'}</span>
                <span className="text-xs font-mono text-red-400">{recordingDuration}</span>
              </div>
              <button
                onClick={onPauseResume}
                className="w-9 h-9 rounded-lg bg-viaim-card border border-viaim-border flex items-center justify-center text-viaim-textMain hover:bg-viaim-cardHover transition-colors cursor-pointer"
                title={isPaused ? '继续录音' : '暂停录音'}
              >
                {isPaused ? <Play className="w-4 h-4 fill-current ml-0.5" /> : <Pause className="w-4 h-4 fill-current" />}
              </button>
              <button
                onClick={onStopRecording}
                className="h-9 px-3 rounded-lg bg-red-600 hover:bg-red-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-md"
                title="结束录制并保存"
              >
                <Square className="w-3 h-3 fill-current" />
                <span>结束</span>
              </button>
            </>
          ) : null}
        </div>
      </div>

      {/* 中栏下方：录制中=实时 ASR 流；未录制=转写内容 / 会议纪要 标签切换 */}
      {isRecording ? (
        liveView
      ) : (
        <>
          <div className="flex items-center gap-1 px-4 pt-2.5 pb-0 border-b border-viaim-border bg-viaim-bg/60 shrink-0">
            <button
              onClick={() => setLowerTab('transcript')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
                lowerTab === 'transcript'
                  ? 'text-indigo-300 border-viaim-primary bg-viaim-card/50'
                  : 'text-viaim-textDim hover:text-viaim-textMain border-transparent'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>转写内容</span>
            </button>
            <button
              onClick={() => setLowerTab('summary')}
              className={`px-3.5 py-2 text-xs font-semibold rounded-t-lg flex items-center gap-1.5 transition-colors cursor-pointer border-b-2 ${
                lowerTab === 'summary'
                  ? 'text-indigo-300 border-viaim-primary bg-viaim-card/50'
                  : 'text-viaim-textDim hover:text-viaim-textMain border-transparent'
              }`}
            >
              <ScrollText className="w-3.5 h-3.5" />
              <span>会议纪要</span>
            </button>
          </div>
          {lowerTab === 'transcript' ? transcriptView : summaryView}
        </>
      )}
    </main>
  );
};
