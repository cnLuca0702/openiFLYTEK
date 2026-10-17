import React, { useEffect, useState } from 'react';
import { AudioLines, Cloud, HardDrive, RadioTower, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../services/api';
import { useToast } from '../hooks/useToast';
import { AsrConfig, AsrStatus } from '../types';

interface AsrSettingsPanelProps {
  onConfigChange?: (config: AsrConfig) => void;
}

const MODES: Array<{
  id: AsrConfig['mode'];
  label: string;
  icon: React.ReactNode;
  desc: string;
}> = [
  {
    id: 'local',
    label: '本地转写',
    icon: <HardDrive className="w-4 h-4" />,
    desc: '录音结束后用本机 whisper.cpp 离线识别，免费、隐私不出机器',
  },
  {
    id: 'online',
    label: '在线转写',
    icon: <Cloud className="w-4 h-4" />,
    desc: '录音结束后调用智谱 glm-asr 云端识别，需配置 GLM API Key',
  },
  {
    id: 'stream',
    label: '流式实时转写',
    icon: <RadioTower className="w-4 h-4" />,
    desc: '录音过程中每 30 秒增量识别并实时上屏，结束即得全文',
  },
];

export const AsrSettingsPanel: React.FC<AsrSettingsPanelProps> = ({ onConfigChange }) => {
  const toast = useToast();
  const [asr, setAsr] = useState<AsrConfig>({ mode: 'local', priority: 'local' });
  const [status, setStatus] = useState<AsrStatus | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const desktop = (window as any).electronAPI;
  const canInstall = desktop?.platform === 'darwin' && !!desktop?.installLocalAsr;
  const [install, setInstall] = useState<{state:string;running:boolean;message:string;downloadedBytes?:number;totalBytes?:number}>({state:'idle',running:false,message:''});
  const [starting, setStarting] = useState(false);
  const [installError, setInstallError] = useState('');

  useEffect(() => {
    if (!canInstall) return;
    let live = true, busy = false, lastState = '';
    const poll = async () => {
      if (busy) return;
      busy = true;
      try {
        const next = await desktop.localAsrInstallStatus();
        if (!live) return;
        setInstall(next);
        if (next.state === 'complete' && lastState !== 'complete') {
          const current = await api.getAsrStatus();
          if (live) setStatus(current);
        }
        lastState = next.state;
      } catch (e:any) { if (live) setInstallError(e.message || '无法读取安装状态'); }
      finally { busy = false; }
    };
    void poll();
    const timer = setInterval(poll, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [canInstall]);

  const startInstall = async () => {
    setStarting(true); setInstallError('');
    try { setInstall(await desktop.installLocalAsr()); }
    catch (e:any) { setInstallError(e.message || '安装未能启动，请重试'); }
    finally { setStarting(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const [cfg, st] = await Promise.all([api.getLlmConfig(), api.getAsrStatus()]);
        if (cfg.asr) setAsr(cfg.asr);
        setStatus(st);
      } catch (err: any) {
        toast.error(err?.message || '读取 ASR 配置失败', { title: '语音转写' });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async (next: AsrConfig) => {
    const prev = asr;
    setAsr(next);
    setIsSaving(true);
    try {
      const cfg = await api.saveLlmConfig({ asr: next });
      if (cfg.asr) setAsr(cfg.asr);
      onConfigChange?.(cfg.asr || next);
      toast.success('ASR 设置已保存', { title: '语音转写' });
    } catch (err: any) {
      setAsr(prev);
      toast.error(err?.message || '保存失败', { title: '语音转写' });
    } finally {
      setIsSaving(false);
    }
  };

  const localOk = status?.local.available;
  const onlineOk = status?.online.available;

  return (
    <div className="space-y-4">
      {/* 转写模式 */}
      <div>
        <h3 className="font-bold text-viaim-textMain flex items-center gap-1.5 mb-2">
          <AudioLines className="w-4 h-4 text-viaim-primary" />
          <span>语音转写（ASR）模式</span>
          {isSaving && <Loader2 className="w-3 h-3 animate-spin text-viaim-textDim" />}
        </h3>
        <div className="space-y-1.5">
          {MODES.map((m) => {
            const selected = asr.mode === m.id;
            const unavailable = (m.id === 'local' || m.id === 'stream') && localOk === false && onlineOk === false;
            return (
              <button
                key={m.id}
                onClick={() => save({ ...asr, mode: m.id })}
                disabled={unavailable}
                className={`w-full text-left p-2.5 rounded-lg border transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                  selected
                    ? 'bg-viaim-primary/15 border-viaim-primary/60'
                    : 'bg-slate-800/50 border-viaim-border hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={selected ? 'text-viaim-primary' : 'text-viaim-textMuted'}>{m.icon}</span>
                  <span className={`text-xs font-bold ${selected ? 'text-viaim-primary' : 'text-viaim-textMain'}`}>
                    {m.label}
                  </span>
                  {selected && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-viaim-primary" />}
                </div>
                <p className="text-[11px] text-viaim-textDim mt-1 leading-relaxed">{m.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* 优先级 */}
      <div className="p-3 rounded-xl bg-slate-900/60 border border-viaim-border space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-viaim-textMain">引擎优先级</p>
            <p className="text-[11px] text-viaim-textDim">
              两个引擎都可用时先用谁；首选失败自动回退另一个
            </p>
          </div>
          <div className="flex rounded-lg border border-viaim-border overflow-hidden">
            {(['local', 'online'] as const).map((p) => (
              <button
                key={p}
                onClick={() => save({ ...asr, priority: p })}
                className={`px-3 py-1.5 text-[11px] font-bold transition-colors cursor-pointer ${
                  asr.priority === p
                    ? 'bg-viaim-primary text-white'
                    : 'bg-viaim-card text-viaim-textMuted hover:text-viaim-textMain'
                }`}
              >
                {p === 'local' ? '本地优先' : '在线优先'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 引擎环境状态 */}
      <div className="grid grid-cols-2 gap-2">
        <div className={`p-3 rounded-xl border ${localOk ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-red-500/40 bg-red-500/5'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {localOk ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-red-600" />
            )}
            <span className="text-[11px] font-bold text-viaim-textMain">本地 whisper.cpp</span>
          </div>
          <p className="text-[10px] text-viaim-textDim break-all">
            {localOk ? `已就绪 · ${status?.local.model}` : !status ? '正在检查本机环境…' : !status.local.cli ? '识别引擎尚未安装' : !status.local.model ? '需要下载语音模型' : '需要安装音频转换工具'}
          </p>
          {canInstall ? (
            <div className="mt-2 space-y-2">
              {(!localOk || install.running) && <>
                <p className="text-[10px] text-viaim-textDim">自动安装识别引擎、音频工具和多语种模型（约 148 MB）。首次准备环境时可能需要 Mac 密码授权。</p>
                <button type="button" disabled={starting || install.running} onClick={() => void startInstall()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-viaim-primary text-white disabled:opacity-50 flex items-center gap-1">
                  {(starting || install.running) && <Loader2 size={12} className="animate-spin" />}
                  {starting || install.running ? '正在安装…' : install.state === 'error' ? '重试安装' : '一键安装本地转写'}
                </button>
              </>}
              {install.message && <p role="status" className="text-[11px] text-viaim-textMuted">{install.message}</p>}
              {install.state === 'model' && <progress aria-label="模型下载进度" className="w-full" max={install.totalBytes || 147951465} value={install.downloadedBytes || 0} />}
              {install.state !== 'idle' && <button type="button" className="text-xs text-viaim-primary" onClick={() => void desktop.openAsrInstallLog().then((error:string) => { if(error)setInstallError('暂时无法打开日志：'+error); }).catch((e:any)=>setInstallError(e.message))}>查看安装日志</button>}
              <button type="button" className="ml-2 text-xs text-viaim-primary" onClick={() => void api.getAsrStatus().then(setStatus).catch((e:any)=>setInstallError(e.message))}>重新检查</button>
              {installError && <p role="alert" className="text-xs text-red-600">{installError}</p>}
            </div>
          ) : !localOk && <p className="mt-2 text-[10px] text-viaim-textDim">请在 macOS 桌面版中点击一键安装。</p>}
        </div>
        <div className={`p-3 rounded-xl border ${onlineOk ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-amber-500/40 bg-amber-500/5'}`}>
          <div className="flex items-center gap-1.5 mb-1">
            {onlineOk ? (
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            ) : (
              <XCircle className="w-3.5 h-3.5 text-amber-600" />
            )}
            <span className="text-[11px] font-bold text-viaim-textMain">在线 glm-asr</span>
          </div>
          <p className="text-[10px] text-viaim-textDim">
            {onlineOk ? 'GLM API Key 已配置' : '需在「大模型引擎」标签配置 GLM'}
          </p>
        </div>
      </div>
    </div>
  );
};
