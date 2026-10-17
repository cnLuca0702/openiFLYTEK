import React, { useState, useEffect } from 'react';
import {
  X,
  Settings,
  Mic,
  Cpu,
  Tablet,
  AudioLines,
  SlidersHorizontal,
} from 'lucide-react';
import { LlmSettingsPanel } from './LlmSettingsPanel';
import { QaSettingsPanel } from './QaSettingsPanel';
import { AsrSettingsPanel } from './AsrSettingsPanel';

interface SettingsModalProps {
  isOpen: boolean;
  initialTab?: SettingsTab;
  onClose: () => void;
}

type SettingsTab = 'general' | 'llm' | 'asr' | 'qa';

const TABS: Array<{ id: SettingsTab; label: string; icon: React.ReactNode }> = [
  { id: 'general', label: '通用与硬件', icon: <SlidersHorizontal className="w-3.5 h-3.5" /> },
  { id: 'llm', label: '大模型LLM设置', icon: <Cpu className="w-3.5 h-3.5" /> },
  { id: 'qa', label: 'AI 问答', icon: <Cpu className="w-3.5 h-3.5" /> },
  { id: 'asr', label: '语音转写 ASR', icon: <AudioLines className="w-3.5 h-3.5" /> },
];

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose, initialTab = 'general' }) => {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  useEffect(() => {if (isOpen) setActiveTab(initialTab);}, [isOpen, initialTab]);
  const [aecEnabled, setAecEnabled] = useState(true);
  const [language, setLanguage] = useState('zh_cn');
  const [autoSyncNotebook, setAutoSyncNotebook] = useState(false);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in">
      <div className="bg-viaim-card border border-viaim-border w-[640px] max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden select-none">
        {/* 标题栏 */}
        <div className="p-4 pb-2 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Settings className="w-5 h-5 text-viaim-primary" />
            <h2 className="text-sm font-bold text-viaim-textMain">设置</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-viaim-cardHover text-viaim-textMuted hover:text-viaim-textMain transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 标签栏 */}
        <div className="flex items-center gap-1 px-4 border-b border-viaim-border shrink-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-bold border-b-2 -mb-px transition-colors cursor-pointer ${
                activeTab === t.id
                  ? 'border-viaim-primary text-viaim-primary'
                  : 'border-transparent text-viaim-textMuted hover:text-viaim-textMain'
              }`}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>

        {/* 设置内容 */}
        <div className="p-5 space-y-4 text-xs flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          {activeTab === 'general' && (
            <>
              {/* 音频与回声消除 */}
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-viaim-border space-y-3">
                <h3 className="font-bold text-viaim-textMain flex items-center gap-1.5">
                  <Mic className="w-4 h-4 text-viaim-cyan" />
                  <span>音频与声学回声消除 (AEC)</span>
                </h3>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-viaim-textMain font-medium">WebRTC AEC3 声学回声消除</p>
                    <p className="text-[11px] text-viaim-textDim">
                      自动抵消电脑扬声器播放的会议声音，避免重复转写并精准区隔说话人
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={aecEnabled}
                    onChange={(e) => setAecEnabled(e.target.checked)}
                    className="w-4 h-4 accent-viaim-primary cursor-pointer"
                  />
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-viaim-border/50">
                  <span className="text-viaim-textMuted">默认输入源</span>
                  <select className="bg-slate-800 border border-viaim-border rounded px-2.5 py-1 text-xs text-viaim-textMain focus:outline-none">
                    <option>VIAIM iFLYBUDS Pro (会议狗 Dongle 无损音频)</option>
                    <option>MacBook Pro 内置麦克风</option>
                    <option>系统音频双通道回环录制 (Loopback)</option>
                  </select>
                </div>
              </div>

              {/* 转写语言 */}
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-viaim-border space-y-3">
                <h3 className="font-bold text-viaim-textMain flex items-center gap-1.5">
                  <AudioLines className="w-4 h-4 text-viaim-cyan" />
                  <span>识别语言</span>
                </h3>
                <div className="flex items-center justify-between">
                  <span className="text-viaim-textMuted">识别主语言</span>
                  <select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="bg-slate-800 border border-viaim-border rounded px-2.5 py-1 text-xs text-viaim-textMain focus:outline-none"
                  >
                    <option value="zh_cn">中文普通话 (自动英译)</option>
                    <option value="en_us">英语 English</option>
                    <option value="zh_cantonese">粤语</option>
                    <option value="ja_jp">日语 Japanese</option>
                  </select>
                </div>
              </div>

              {/* 智能办公本联动选项 */}
              <div className="p-3.5 rounded-xl bg-slate-900/60 border border-viaim-border space-y-2">
                <h3 className="font-bold text-viaim-textMain flex items-center gap-1.5">
                  <Tablet className="w-4 h-4 text-amber-600" />
                  <span>科大讯飞智能办公本跨生态联动</span>
                </h3>

                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-viaim-textMain font-medium">会议结束自动推送到办公本墨水屏</p>
                    <p className="text-[11px] text-viaim-textDim">
                      每次会议生成纪要后，自动通过 IoT 文件驿站推送到绑定的 X2/Air 办公本
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={autoSyncNotebook}
                    onChange={(e) => setAutoSyncNotebook(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 cursor-pointer"
                  />
                </div>
              </div>

            </>
          )}

          {activeTab === 'llm' && <LlmSettingsPanel />}

          {activeTab === 'qa' && <QaSettingsPanel />}
          {activeTab === 'asr' && <AsrSettingsPanel />}
        </div>

        {/* 底部按钮 */}
        <div className="p-4 border-t border-viaim-border flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-viaim-primary hover:bg-viaim-primaryHover text-white text-xs font-bold shadow-glow-primary transition-all cursor-pointer"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  );
};
