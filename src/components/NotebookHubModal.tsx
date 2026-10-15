import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Tablet,
  Wifi,
  Battery,
  FileText,
  Mic,
  Download,
  Clock,
  RefreshCw,
  CheckCircle2,
  ExternalLink,
  LogIn,
  KeyRound,
  ShieldCheck,
  AlertCircle,
  QrCode,
  Tag,
  Folder,
  Calendar,
  CheckSquare,
  Share2,
  Trash2,
  History,
  RotateCcw,
  Smartphone
} from 'lucide-react';
import { OfficeNotebookDevice, OfficeNotebookNote } from '../types';
import { api } from '../services/api';
import { ConfirmActions, ConfirmAction } from './ConfirmModal';
import { useConfirm } from '../hooks/useConfirm';
import { useToast } from '../hooks/useToast';

interface NotebookHubModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportNoteAsMeeting: (note: OfficeNotebookNote) => Promise<void>;
}

type TabKey = 'cloud' | 'recycle' | 'tags' | 'dirs' | 'schedule' | 'things' | 'fileports' | 'share';

export const NotebookHubModal: React.FC<NotebookHubModalProps> = ({
  isOpen,
  onClose,
  onImportNoteAsMeeting
}) => {
  const toast = useToast();
  const confirm = useConfirm();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [devices, setDevices] = useState<OfficeNotebookDevice[]>([]);
  const [notes, setNotes] = useState<OfficeNotebookNote[]>([]);
  const [notesTotal, setNotesTotal] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [hiddenNoteIds, setHiddenNoteIds] = useState<Set<string>>(new Set());

  // 多 tab 数据
  const [activeTab, setActiveTab] = useState<TabKey>('cloud');
  const [recycleList, setRecycleList] = useState<any[]>([]);
  const [tagsList, setTagsList] = useState<any[]>([]);
  const [dirsList, setDirsList] = useState<any[]>([]);
  const [scheduleList, setScheduleList] = useState<any[]>([]);
  const [thingsList, setThingsList] = useState<any[]>([]);
  const [filePorts, setFilePorts] = useState<any[]>([]);
  const [shareNoteId, setShareNoteId] = useState<string>('');
  const [shareResult, setShareResult] = useState<string>('');
  const [accountName, setAccountName] = useState<string>('');

  // 二次确认：使用全局 useConfirm() + ConfirmHost 渲染器，无需本地状态
  // 登录表单
  const [loginMode, setLoginMode] = useState<'password' | 'token' | 'qrcode'>('password');
  const [mobile, setMobile] = useState('15858185982');
  const [password, setPassword] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 微信扫码
  const [qrUrl, setQrUrl] = useState<string>('');
  const [qrTempToken, setQrTempToken] = useState<string>('');
  const [qrStatus, setQrStatus] = useState<'idle' | 'waiting' | 'scanned' | 'expired' | 'success'>('idle');
  const [qrMessage, setQrMessage] = useState<string>('请使用讯飞办公本 App 或微信扫描二维码完成登录');
  const qrPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isOpen) {
      loadData();
    }
    return () => {
      if (qrPollRef.current) {
        clearInterval(qrPollRef.current);
        qrPollRef.current = null;
      }
    };
  }, [isOpen]);

  const loadData = async () => {
    setLoading(true);
    setAuthError(null);
    try {
      const devRes = await api.getNotebookDevices();
      // authenticated 仅表示本地有 token；sessionValid 才表示云端会话真实可用
      const sessionInvalid = !!devRes?.authenticated && (devRes as any)?.sessionValid === false;
      const isAuth = !!devRes?.authenticated && !sessionInvalid;
      setIsAuthenticated(isAuth);
      if (sessionInvalid) {
        setAuthError(`讯飞账号会话已失效：${(devRes as any)?.sessionReason || '请重新登录'}`);
      }
      if (isAuth) {
        if ((devRes as any)?.userInfo?.userName) {
          setAccountName((devRes as any).userInfo.userName);
        }
        setDevices(devRes?.devices || []);
        const noteRes = await api.getNotebookNotes();
        setNotes(noteRes?.list || []);
        setNotesTotal(typeof noteRes?.total === 'number' ? noteRes.total : (noteRes?.list?.length || 0));
      } else {
        setDevices([]);
        setNotes([]);
        setNotesTotal(0);
      }
    } catch (e: any) {
      console.error(e);
      setAuthError(e.message || '连接讯飞云服务异常');
    } finally {
      setLoading(false);
    }
  };

  const loadTabData = async (tab: TabKey) => {
    if (!isAuthenticated) return;
    try {
      switch (tab) {
        case 'recycle': {
          const d = await api.getRecycleList();
          setRecycleList(Array.isArray(d) ? d : (d?.list || []));
          break;
        }
        case 'tags': {
          const d = await api.getNotebookTags();
          setTagsList(Array.isArray(d) ? d : (d?.list || []));
          break;
        }
        case 'dirs': {
          const d = await api.getNotebookDirs();
          setDirsList(Array.isArray(d) ? d : (d?.list || []));
          break;
        }
        case 'schedule': {
          const now = Date.now();
          const d = await api.getNotebookSchedules(now - 30 * 86400000, now + 60 * 86400000);
          setScheduleList(Array.isArray(d) ? d : (d?.list || []));
          break;
        }
        case 'things': {
          const d = await api.getNotebookThings();
          setThingsList(Array.isArray(d) ? d : (d?.list || []));
          break;
        }
        case 'fileports': {
          const d = await api.getFilePortList();
          setFilePorts(Array.isArray(d) ? d : (d?.list || []));
          break;
        }
      }
    } catch (e: any) {
      toast.error(`读取失败: ${e?.message || '云端异常'}`, { title: '云端读取失败', duration: 5000 });
    }
  };

  // ============== 登录 ==============
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setAuthError(null);
    try {
      if (loginMode === 'password') {
        if (!mobile || !password) throw new Error('请输入手机号和密码');
        await api.loginNotebook(mobile, password);
      } else if (loginMode === 'token') {
        if (!tokenInput.trim()) throw new Error('请输入 Token');
        await api.setNotebookToken(tokenInput.trim());
      } else {
        // qrcode 模式由 startQrLogin 单独处理
        return;
      }
      await loadData();
    } catch (err: any) {
      setAuthError(err.message || '登录失败，请检查账号密码或网络连接');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ============== 微信扫码登录 ==============
  const startQrLogin = async () => {
    setIsSubmitting(true);
    setAuthError(null);
    setQrStatus('idle');
    setQrMessage('正在申请扫码登录凭据...');
    try {
      const data: any = await api.getNotebookCliLoginUrl();
      const token = data?.tempToken || data?.token;
      const url = data?.qrUrl || data?.qrContent || data?.url || data?.loginUrl;
      if (!token) throw new Error('云端未返回 tempToken，请检查网络');
      setQrTempToken(token);
      setQrUrl(url || '');
      setQrStatus('waiting');
      setQrMessage('请使用讯飞办公本 App 扫描下方二维码完成登录');
      // 启动 2 秒轮询
      if (qrPollRef.current) clearInterval(qrPollRef.current);
      qrPollRef.current = setInterval(() => pollQrLogin(token), 2000);
    } catch (err: any) {
      setAuthError(err.message || '申请扫码登录 URL 失败');
      setQrStatus('expired');
    } finally {
      setIsSubmitting(false);
    }
  };

  const pollQrLogin = async (token: string) => {
    if (qrStatus === 'success' || qrStatus === 'expired') return;
    try {
      const status = await api.getNotebookCliStatus(token);
      const state = status?.status || status?.state;
      if (state === 'scanned' || state === 'confirmed' || state === '2') {
        setQrStatus('scanned');
        setQrMessage('扫码成功，请在手机端点击「确认登录」');
      } else if (state === 'expired' || state === '4') {
        setQrStatus('expired');
        setQrMessage('二维码已过期，请重新申请');
        if (qrPollRef.current) clearInterval(qrPollRef.current);
        return;
      }

      // 同时尝试拉最终结果（含 token）
      const result = await api.pollNotebookCliLogin(token);
      const finalToken = result?.userToken || result?.token || result?.data?.token;
      const webCode = result?.code || result?.webCode || result?.data?.code;
      if (finalToken) {
        if (qrPollRef.current) clearInterval(qrPollRef.current);
        setQrStatus('success');
        setQrMessage('登录成功！正在加载数据...');
        await loadData();
        setTimeout(() => setActiveTab('cloud'), 600);
      } else if (webCode) {
        // 通过 web code 再换一次
        try {
          const t = await api.exchangeNotebookCliToken(webCode);
          if (t?.userToken || t?.token) {
            if (qrPollRef.current) clearInterval(qrPollRef.current);
            setQrStatus('success');
            setQrMessage('登录成功！');
            await loadData();
            setTimeout(() => setActiveTab('cloud'), 600);
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[qr poll]', err);
    }
  };

  const handleLogout = async () => {
    try {
      await api.logoutNotebook();
      setIsAuthenticated(false);
      setDevices([]);
      setNotes([]);
      setNotesTotal(0);
      setTokenInput('');
      setPassword('');
      setAuthError(null);
      if (qrPollRef.current) clearInterval(qrPollRef.current);
      setQrStatus('idle');
      setQrUrl('');
    } catch (err: any) {
      console.error('Logout error:', err);
    }
  };

  const handleImport = async (note: OfficeNotebookNote) => {
    setImportingId(note.noteId);
    try {
      await onImportNoteAsMeeting(note);
      toast.success('已完成下载校验并导入项目会议库，可离线播放录音。', { title: '办公本笔记已导入', duration: 4000 });
      onClose();
    } catch (error: any) {
      const stage = error?.detail?.stage;
      toast.error(`导入未完成${stage ? `（${stage}）` : ''}: ${error?.message || '云端或缓存异常'}`, { title: '办公本导入失败', duration: 6000 });
    } finally {
      setImportingId(null);
    }
  };

  // 仅本地隐藏该笔记（云端保留）
  const handleHideNote = (noteId: string) => {
    setHiddenNoteIds((prev) => {
      const next = new Set(prev);
      next.add(noteId);
      return next;
    });
  };

  // 移入云端回收站（带二次确认）
  const handleRecycleCloud = async (note: OfficeNotebookNote) => {
    const ok = await confirm(ConfirmActions.recycleNote(note.title, note.noteId));
    if (!ok) return;
    try {
      await api.recycleNoteOnCloud(note.noteId);
      setNotes((prev) => prev.filter((n) => n.noteId !== note.noteId));
      toast.success('已移入云端回收站', { duration: 2500 });
    } catch (e: any) {
      toast.error(`移入回收站失败: ${e?.message || '云端异常'}`, { title: '操作失败', duration: 5000 });
    }
  };

  // 从回收站恢复（带二次确认）
  const handleRecover = async (n: any) => {
    const ok = await confirm({
      title: '恢复笔记到云端列表',
      scope: '讯飞云端 + 本地 UI',
      target: `${n.title || n.noteName || '笔记'} (${(n.noteId || n.id).substring(0, 12)}...)`,
      consequence: '该笔记将从回收站恢复到云端笔记列表，所有设备可重新访问。',
      variant: 'info',
      confirmText: '确认恢复'
    });
    if (!ok) return;
    try {
      await api.recoverRecycleNotes([n.noteId || n.id]);
      setRecycleList((prev) => prev.filter((x: any) => (x.noteId || x.id) !== (n.noteId || n.id)));
      toast.success('已恢复', { duration: 2500 });
    } catch (e: any) {
      toast.error(`恢复失败: ${e?.message || '云端异常'}`, { title: '操作失败', duration: 5000 });
    }
  };

  // 云端真删除（带二次确认）
  const handleDeleteCloud = async (n: any) => {
    const ok = await confirm(ConfirmActions.deleteFromCloud(n.title || n.noteName || '笔记', n.noteId || n.id));
    if (!ok) return;
    try {
      await api.deleteNoteFromCloud(n.noteId || n.id);
      setRecycleList((prev) => prev.filter((x: any) => (x.noteId || x.id) !== (n.noteId || n.id)));
      toast.success('已从云端删除', { duration: 2500 });
    } catch (e: any) {
      toast.error(`云端删除失败: ${e?.message || '云端异常'}`, { title: '操作失败', duration: 5000 });
    }
  };

  // 切换云端待办（带二次确认）
  const handleToggleCloudThing = async (t: any) => {
    const id = t.thingId || t.id;
    const done = !(t.doneFlag === 1 || t.done === true);
    const ok = await confirm(ConfirmActions.toggleCloudThing(t.content || t.title || '待办'));
    if (!ok) return;
    try {
      await api.toggleCloudThing(id, done);
      setThingsList((prev) => prev.map((x: any) =>
        (x.thingId || x.id) === id ? { ...x, doneFlag: done ? 1 : 0, done } : x
      ));
    } catch (e: any) {
      toast.error(`更新失败: ${e?.message || '云端异常'}`, { title: '操作失败', duration: 5000 });
    }
  };

  // 分享云笔记（带二次确认）
  const handleShare = async (noteId: string, type: number, noteTitle?: string) => {
    const ok = await confirm(ConfirmActions.shareNote(noteTitle || noteId, noteId));
    if (!ok) return;
    setShareNoteId(noteId);
    setShareResult('生成中...');
    try {
      const data = await api.shareNoteToCloud(noteId, { type, days: 7, restricted: 1 });
      const link = data?.shareUrl || data?.url || data?.link || data?.shortUrl;
      setShareResult(link ? `分享链接: ${link}` : '分享成功（响应: ' + JSON.stringify(data).slice(0, 200) + '）');
    } catch (e: any) {
      setShareResult(`分享失败: ${e?.message || '云端异常'}`);
    }
  };

  // 删除 FilePort 推送历史（带二次确认）
  const handleDeleteFilePort = async (p: any) => {
    const id = p.filePortId || p.id;
    const ok = await confirm({
      title: '删除推送历史记录',
      scope: '讯飞读写驿站 IoT 服务',
      target: `${p.fileName || p.name || '文件'} (${(id || '').substring(0, 12)}...)`,
      consequence: '该推送记录从讯飞云端 IoT 历史中删除，办公本设备不再显示此条文件，但云端 OSS 文件本身不受影响。',
      typeToConfirm: 'DEL',
      variant: 'danger',
      confirmText: '删除历史记录'
    });
    if (!ok) return;
    try {
      await api.deleteFilePort(id);
      setFilePorts((prev) => prev.filter((x: any) => (x.filePortId || x.id) !== id));
    } catch (e: any) {
      toast.error(`删除失败: ${e?.message || '云端异常'}`, { title: '操作失败', duration: 5000 });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md animate-in fade-in">
      <div className="bg-viaim-card border border-amber-500/30 w-[860px] max-h-[88vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden select-none">
        {/* 顶部标题栏 */}
        <div className="p-4 border-b border-viaim-border bg-amber-500/10 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-600 flex items-center justify-center font-bold">
              <Tablet className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-viaim-textMain flex items-center gap-2">
                <span>科大讯飞智能办公本 · 互联工作台</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${
                  isAuthenticated ? 'bg-amber-500/20 text-amber-700' : 'bg-slate-700 text-slate-300'
                }`}>
                  {isAuthenticated ? '真实环境已连接' : '未连接网关'}
                </span>
              </h2>
              <p className="text-[11px] text-amber-700/70">
                {isAuthenticated && accountName ? `当前账号: ${accountName} · ` : ''}直连 https://api.iflyink.com/xbew-api · 资产管理、离线笔记同传与读写驿站
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                onClick={handleLogout}
                className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-amber-500/20 text-slate-300 hover:text-amber-600 border border-slate-700 hover:border-amber-500/40 transition-colors cursor-pointer"
                title="退出当前讯飞账号并切换"
              >
                切换账号
              </button>
            )}
            <button
              onClick={() => { loadData(); loadTabData(activeTab); }}
              disabled={loading}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-viaim-textMuted hover:text-viaim-textMain transition-colors"
              title="刷新数据"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-800 text-viaim-textMuted hover:text-viaim-textMain transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Tab 栏（仅登录后） */}
        {isAuthenticated && (
          <div className="flex items-center gap-1 px-4 pt-2 border-b border-viaim-border bg-viaim-bg/40 text-[11px] overflow-x-auto shrink-0 custom-scrollbar">
            {[
              { k: 'cloud',     l: '云端笔记', icon: FileText },
              { k: 'recycle',   l: '云端回收站', icon: History },
              { k: 'tags',      l: '标签', icon: Tag },
              { k: 'dirs',      l: '目录', icon: Folder },
              { k: 'schedule',  l: '日程', icon: Calendar },
              { k: 'things',    l: '待办', icon: CheckSquare },
              { k: 'fileports', l: '推送历史', icon: Share2 },
              { k: 'share',     l: '分享/回收站工具', icon: Trash2 }
            ].map(({ k, l, icon: Icon }) => (
              <button
                key={k}
                onClick={() => { setActiveTab(k as TabKey); loadTabData(k as TabKey); }}
                className={`px-2.5 py-1.5 rounded-t-lg flex items-center gap-1 whitespace-nowrap transition-colors cursor-pointer ${
                  activeTab === k
                    ? 'bg-amber-500/15 text-amber-600 border-t border-x border-amber-500/40'
                    : 'text-slate-400 hover:text-viaim-textMain hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {l}
              </button>
            ))}
          </div>
        )}

        {/* 主体内容 */}
        <div className="p-5 overflow-y-auto space-y-5 custom-scrollbar flex-1 min-h-0">
          {/* 未登录鉴权面板 */}
          {!isAuthenticated ? (
            <div className="p-5 rounded-2xl bg-slate-900/80 border border-amber-500/30 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
                  <LogIn className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-viaim-textMain">登录科大讯飞智能办公本账号</h3>
                  <p className="text-xs text-viaim-textMuted mt-0.5">
                    支持密码登录、手工填 Token、<span className="text-amber-600">微信/讯飞办公本 App 扫码登录</span>。
                  </p>
                </div>
              </div>

              {authError && (
                <div className="p-3 rounded-xl bg-red-950/40 border border-red-500/40 text-xs text-red-600 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{authError}</span>
                </div>
              )}

              {/* 登录方式切换 */}
              <div className="flex items-center gap-2 border-b border-slate-800 pb-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLoginMode('password')}
                  className={`pb-1 font-semibold transition-colors cursor-pointer ${
                    loginMode === 'password'
                      ? 'text-amber-600 border-b-2 border-amber-400'
                      : 'text-slate-400 hover:text-viaim-textMain'
                  }`}
                >
                  手机号密码登录
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMode('token')}
                  className={`pb-1 font-semibold transition-colors cursor-pointer ${
                    loginMode === 'token'
                      ? 'text-amber-600 border-b-2 border-amber-400'
                      : 'text-slate-400 hover:text-viaim-textMain'
                  }`}
                >
                  直接输入 Token
                </button>
                <button
                  type="button"
                  onClick={() => setLoginMode('qrcode')}
                  className={`pb-1 font-semibold transition-colors cursor-pointer flex items-center gap-1 ${
                    loginMode === 'qrcode'
                      ? 'text-amber-600 border-b-2 border-amber-400'
                      : 'text-slate-400 hover:text-viaim-textMain'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" />
                  微信/App 扫码登录
                </button>
              </div>

              {/* 密码登录表单 */}
              {loginMode === 'password' && (
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-viaim-textMuted mb-1">讯飞注册手机号</label>
                    <input
                      type="text"
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="请输入手机号"
                      className="w-full bg-slate-950 border border-viaim-border rounded-lg px-3 py-2 text-xs text-viaim-textMain focus:outline-none focus:border-amber-400"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-viaim-textMuted mb-1">账号密码</label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="请输入讯飞读写客/智能办公本密码"
                      className="w-full bg-slate-950 border border-viaim-border rounded-lg px-3 py-2 text-xs text-viaim-textMain focus:outline-none focus:border-amber-400"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? '正在鉴权中...' : '立即登录并连接办公本'}</span>
                  </button>
                </form>
              )}

              {/* Token 登录 */}
              {loginMode === 'token' && (
                <form onSubmit={handleLogin} className="space-y-3">
                  <div>
                    <label className="block text-[11px] text-viaim-textMuted mb-1">讯飞 Auth Token</label>
                    <textarea
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      placeholder="请粘贴抓包或已有的 xbew-api Session Token..."
                      rows={3}
                      className="w-full bg-slate-950 border border-viaim-border rounded-lg px-3 py-2 text-xs text-viaim-textMain focus:outline-none focus:border-amber-400 font-mono"
                      required
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? '正在鉴权中...' : '使用 Token 登录'}</span>
                  </button>
                </form>
              )}

              {/* 微信扫码登录 */}
              {loginMode === 'qrcode' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-4">
                    <div className="shrink-0 w-44 h-44 rounded-xl border-2 border-amber-500/40 bg-white flex items-center justify-center overflow-hidden">
                      {qrUrl ? (
                        qrUrl.startsWith('data:image') || qrUrl.startsWith('http') ? (
                          <img src={qrUrl} alt="扫码登录" className="w-full h-full object-contain" />
                        ) : (
                          <div className="text-[10px] text-viaim-textDim p-2 break-all leading-tight">
                            {qrUrl}
                          </div>
                        )
                      ) : (
                        <div className="text-center text-slate-400 p-4">
                          <QrCode className="w-12 h-12 mx-auto opacity-30" />
                          <p className="text-[10px] mt-2">尚未生成二维码</p>
                        </div>
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <div className={`p-2.5 rounded-lg text-xs border ${
                        qrStatus === 'success' ? 'bg-emerald-950/30 border-emerald-500/40 text-emerald-600' :
                        qrStatus === 'expired' ? 'bg-red-950/30 border-red-500/40 text-red-600' :
                        qrStatus === 'scanned' ? 'bg-amber-950/30 border-amber-500/40 text-amber-600' :
                        'bg-slate-900/60 border-viaim-border text-viaim-textMuted'
                      }`}>
                        <p className="font-semibold flex items-center gap-1.5">
                          {qrStatus === 'success' ? <CheckCircle2 className="w-3.5 h-3.5" /> :
                           qrStatus === 'scanned' ? <Smartphone className="w-3.5 h-3.5" /> :
                           <QrCode className="w-3.5 h-3.5" />}
                          {qrMessage}
                        </p>
                      </div>
                      <button
                        onClick={startQrLogin}
                        disabled={isSubmitting || qrStatus === 'waiting' || qrStatus === 'scanned'}
                        className="w-full py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <QrCode className="w-3.5 h-3.5" />
                        <span>
                          {qrStatus === 'idle' || qrStatus === 'expired' ? '生成扫码二维码' :
                           qrStatus === 'waiting' ? '等待扫码中...' :
                           qrStatus === 'scanned' ? '请在手机上点击确认' :
                           '登录成功'}
                        </span>
                      </button>
                      <p className="text-[10px] text-viaim-textDim leading-relaxed">
                        扫码登录走讯飞开放接口 /user/getCliLoginUrl + getCliLoginResult，本机不接触任何密码，更安全。
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              {/* 1. 绑定的真实办公本硬件列表 */}
              {activeTab === 'cloud' && (
                <>
                  <div>
                    <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                      <span>已绑定的智能办公本硬件</span>
                      <span className="text-viaim-textDim font-normal">({devices.length})</span>
                    </h3>

                    {devices.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-viaim-border text-center text-xs text-viaim-textDim">
                        当前讯飞账号下暂未查询到绑定的智能办公本硬件，请确认设备已开机并登录相同账号。
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {devices.map((dev) => (
                          <div
                            key={dev.deviceId}
                            className="p-3.5 rounded-xl border border-amber-500/25 bg-slate-900/60 flex flex-col justify-between"
                          >
                            <div className="flex items-start justify-between gap-2 mb-2">
                              <div>
                                <h4 className="text-xs font-bold text-viaim-textMain">{dev.deviceName}</h4>
                                <span className="text-[10px] text-viaim-textDim font-mono">
                                  型号: {dev.deviceModel} · 固件: {dev.osVersion}
                                </span>
                              </div>
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-semibold flex items-center gap-1 ${
                                  dev.isOnline
                                    ? 'bg-emerald-500/20 text-emerald-600'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                <Wifi className="w-2.5 h-2.5" />
                                {dev.isOnline ? '在线' : '离线'}
                              </span>
                            </div>
                            <div className="flex items-center justify-between text-[11px] text-viaim-textMuted pt-2 border-t border-viaim-border/50">
                              <span className="text-[10px] text-slate-400 font-mono">
                                ID: {dev.deviceId.substring(0, 16)}...
                              </span>
                              <span>最后登录: {dev.lastLoginTime ? dev.lastLoginTime.split(' ')[0] : '最近'}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* 2. 办公本云端笔记库 */}
                  <div>
                    <div className="flex items-center justify-between mb-2.5">
                      <h3 className="text-xs font-bold text-viaim-textMain flex items-center gap-1.5">
                        <span>办公本离线录音与手写笔记库</span>
                        <span className="text-viaim-textDim font-normal">
                          ({notes.length}{notesTotal > notes.length ? ` / 共 ${notesTotal}` : ''})
                        </span>
                      </h3>
                      <span className="text-[11px] text-amber-600">
                        可一键拉取至桌面工作台二次提炼
                      </span>
                    </div>

                    {notes.length === 0 ? (
                      <div className="p-4 rounded-xl border border-dashed border-viaim-border text-center text-xs text-viaim-textDim">
                        当前云端笔记库为空，或办公本离线笔记尚未同步上传至讯飞云端。
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {notes.filter((n) => !hiddenNoteIds.has(n.noteId)).map((note) => (
                          <div
                            key={note.noteId}
                            className="p-3 rounded-xl border border-viaim-border bg-viaim-bg/60 hover:border-amber-500/40 transition-all flex items-center justify-between gap-4"
                          >
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {(note as any).typeLabel && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 font-mono">
                                    {(note as any).typeLabel}
                                  </span>
                                )}
                                <span className="text-xs font-bold text-viaim-textMain">{note.title}</span>
                                {note.hasAudio && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 font-mono flex items-center gap-1">
                                    <Mic className="w-2.5 h-2.5" />
                                    {note.audioDuration || '包含录音'}
                                  </span>
                                )}
                                {note.hasAudio && note.downloadState === 'ready' && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 font-mono">
                                    已缓存，可离线播放
                                  </span>
                                )}
                                {note.hasAudio && note.downloadState === 'failed' && (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-500/20 text-red-600 border border-red-500/30 font-mono">
                                    缓存失败，可重试
                                  </span>
                                )}
                                {note.isEncrypt ? (
                                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-500/20 text-red-600 border border-red-500/30 font-mono">
                                    🔒 加密
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-[11px] text-viaim-textMuted line-clamp-1">
                                {note.summary || '手写笔迹及录音云笔记'}
                              </p>
                              <span className="text-[10px] text-viaim-textDim mt-1 inline-block">
                                更新于 {new Date(note.updateTime).toLocaleString()}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              <button
                                onClick={() => handleShare(note.noteId, (note as any).type || 1, note.title)}
                                className="p-1.5 rounded-lg hover:bg-cyan-500/15 text-slate-400 hover:text-cyan-300 border border-transparent hover:border-cyan-500/30 transition-colors cursor-pointer"
                                title="生成云端分享链接"
                              >
                                <Share2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleRecycleCloud(note)}
                                className="p-1.5 rounded-lg hover:bg-amber-500/15 text-slate-400 hover:text-amber-600 border border-transparent hover:border-amber-500/30 transition-colors cursor-pointer"
                                title="移入云端回收站（30 天内可恢复）"
                              >
                                <History className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleHideNote(note.noteId)}
                                className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-600 border border-transparent hover:border-red-500/30 transition-colors cursor-pointer"
                                title="仅本地隐藏该笔记（云端保留）"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => handleImport(note)}
                                disabled={importingId === note.noteId}
                                className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-600 border border-amber-500/30 text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>{importingId === note.noteId ? '下载并导入中...' : '下载并导入'}</span>
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* 云端回收站 */}
              {activeTab === 'recycle' && (
                <div>
                  <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                    <History className="w-4 h-4 text-amber-600" />
                    <span>云端回收站（30 天可恢复）</span>
                    <span className="text-viaim-textDim font-normal">({recycleList.length})</span>
                  </h3>
                  {recycleList.length === 0 ? (
                    <div className="p-6 text-center text-viaim-textDim text-xs border border-dashed border-viaim-border rounded-xl">
                      云端回收站为空
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {recycleList.map((n: any) => (
                        <div key={n.noteId || n.id} className="p-3 rounded-xl border border-viaim-border bg-viaim-bg/60 flex items-center justify-between gap-3">
                          <div className="flex-1">
                            <p className="text-xs font-bold text-viaim-textMain">{n.title || n.noteName || '已删除笔记'}</p>
                            <p className="text-[10px] text-viaim-textDim">删除时间: {n.deleteTime ? new Date(n.deleteTime).toLocaleString() : '未知'}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleRecover(n)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-600 border border-emerald-500/30 text-xs hover:bg-emerald-500/30 cursor-pointer flex items-center gap-1"
                            >
                              <RotateCcw className="w-3 h-3" /> 恢复
                            </button>
                            <button
                              onClick={() => handleDeleteCloud(n)}
                              className="px-2.5 py-1 rounded-lg bg-red-500/20 text-red-600 border border-red-500/30 text-xs hover:bg-red-500/30 cursor-pointer flex items-center gap-1"
                            >
                              <Trash2 className="w-3 h-3" /> 真删
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 标签 */}
              {activeTab === 'tags' && (
                <div>
                  <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                    <Tag className="w-4 h-4 text-amber-600" />
                    <span>云端标签库</span>
                    <span className="text-viaim-textDim font-normal">({tagsList.length})</span>
                  </h3>
                  {tagsList.length === 0 ? (
                    <div className="p-6 text-center text-viaim-textDim text-xs border border-dashed border-viaim-border rounded-xl">
                      暂无标签
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {tagsList.map((t: any) => (
                        <span key={t.tagId || t.id} className="px-3 py-1.5 rounded-lg bg-viaim-bg border border-amber-500/30 text-xs text-amber-600">
                          #{t.tagName || t.tag || t.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 目录 */}
              {activeTab === 'dirs' && (
                <div>
                  <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                    <Folder className="w-4 h-4 text-amber-600" />
                    <span>云端笔记目录</span>
                    <span className="text-viaim-textDim font-normal">({dirsList.length})</span>
                  </h3>
                  {dirsList.length === 0 ? (
                    <div className="p-6 text-center text-viaim-textDim text-xs border border-dashed border-viaim-border rounded-xl">
                      暂无目录
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      {dirsList.map((d: any) => (
                        <div key={d.dirId || d.id} className="p-3 rounded-lg border border-viaim-border bg-viaim-bg/60">
                          <p className="text-xs font-bold text-viaim-textMain">{d.dirName || d.name}</p>
                          <p className="text-[10px] text-viaim-textDim">排序: {d.sort ?? 0} · 子项: {d.noteCount ?? '?'}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 日程 */}
              {activeTab === 'schedule' && (
                <div>
                  <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                    <Calendar className="w-4 h-4 text-amber-600" />
                    <span>云端日程</span>
                    <span className="text-viaim-textDim font-normal">({scheduleList.length})</span>
                  </h3>
                  {scheduleList.length === 0 ? (
                    <div className="p-6 text-center text-viaim-textDim text-xs border border-dashed border-viaim-border rounded-xl">
                      近 90 天无日程
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {scheduleList.slice(0, 30).map((s: any, i: number) => (
                        <div key={s.scheduleId || s.id || i} className="p-3 rounded-lg border border-viaim-border bg-viaim-bg/60">
                          <p className="text-xs font-bold text-viaim-textMain">{s.title || s.content || '日程'}</p>
                          <p className="text-[10px] text-viaim-textDim">
                            {s.startTime ? new Date(Number(s.startTime)).toLocaleString() : ''} ~ {s.endTime ? new Date(Number(s.endTime)).toLocaleString() : ''}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* 待办 */}
              {activeTab === 'things' && (
                <div>
                  <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                    <CheckSquare className="w-4 h-4 text-amber-600" />
                    <span>讯飞办公本待办事项</span>
                    <span className="text-viaim-textDim font-normal">({thingsList.length})</span>
                  </h3>
                  {thingsList.length === 0 ? (
                    <div className="p-6 text-center text-viaim-textDim text-xs border border-dashed border-viaim-border rounded-xl">
                      暂无待办
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {thingsList.map((t: any, i: number) => {
                        const id = t.thingId || t.id;
                        const done = t.doneFlag === 1 || t.done === true;
                        return (
                          <div
                            key={id || i}
                            onClick={() => handleToggleCloudThing(t)}
                            className={`p-3 rounded-lg border cursor-pointer flex items-center gap-2.5 transition-all ${
                              done
                                ? 'bg-emerald-950/20 border-emerald-500/30 line-through text-viaim-textDim'
                                : 'bg-viaim-bg/60 border-viaim-border hover:border-amber-500/40'
                            }`}
                          >
                            <input type="checkbox" checked={done} readOnly className="rounded accent-amber-500" />
                            <div className="flex-1">
                              <p className="text-xs">{t.content || t.title || t.name || '待办'}</p>
                              <p className="text-[10px] text-viaim-textDim">
                                {t.dueTime ? `截止: ${new Date(Number(t.dueTime)).toLocaleString()}` : ''}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 推送历史 */}
              {activeTab === 'fileports' && (
                <div>
                  <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                    <Share2 className="w-4 h-4 text-amber-600" />
                    <span>读写驿站推送历史</span>
                    <span className="text-viaim-textDim font-normal">({filePorts.length})</span>
                  </h3>
                  {filePorts.length === 0 ? (
                    <div className="p-6 text-center text-viaim-textDim text-xs border border-dashed border-viaim-border rounded-xl">
                      暂无推送历史
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {filePorts.map((p: any, i: number) => {
                        const id = p.filePortId || p.id;
                        return (
                          <div key={id || i} className="p-3 rounded-lg border border-viaim-border bg-viaim-bg/60 flex items-center justify-between gap-3">
                            <div className="flex-1">
                              <p className="text-xs font-bold text-viaim-textMain">{p.fileName || p.name || '推送文件'}</p>
                              <p className="text-[10px] text-viaim-textDim font-mono break-all">
                                {p.downloadUrl || p.fileUrl || '-'}
                              </p>
                              <p className="text-[10px] text-viaim-textDim">
                                {p.createTime ? new Date(Number(p.createTime)).toLocaleString() : ''}
                              </p>
                            </div>
                            <button
                              onClick={() => handleDeleteFilePort(p)}
                              className="p-1.5 rounded-lg hover:bg-red-500/15 text-slate-400 hover:text-red-600 border border-transparent hover:border-red-500/30 cursor-pointer"
                              title="从推送历史移除"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 分享 / 回收站工具 */}
              {activeTab === 'share' && (
                <div className="space-y-3">
                  <div>
                    <h3 className="text-xs font-bold text-viaim-textMain mb-2.5 flex items-center gap-1.5">
                      <Share2 className="w-4 h-4 text-cyan-400" />
                      分享云笔记生成链接
                    </h3>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={shareNoteId}
                        onChange={(e) => setShareNoteId(e.target.value)}
                        placeholder="输入笔记 ID"
                        className="flex-1 bg-slate-950 border border-viaim-border rounded-lg px-3 py-2 text-xs text-viaim-textMain font-mono"
                      />
                      <button
                        onClick={() => handleShare(shareNoteId, 1)}
                        disabled={!shareNoteId}
                        className="px-3 py-2 rounded-lg bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-xs font-semibold hover:bg-cyan-500/30 cursor-pointer disabled:opacity-50"
                      >
                        生成分享
                      </button>
                    </div>
                    {shareResult && (
                      <p className="mt-2 text-[11px] text-amber-600 break-all font-mono">{shareResult}</p>
                    )}
                  </div>

                  <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
                    <p className="text-xs font-bold text-amber-600 mb-1">数据生命周期</p>
                    <ul className="text-[11px] text-viaim-textMuted space-y-1 list-disc list-inside">
                      <li>从云端列表移入回收站：30 天内可恢复</li>
                      <li>从回收站「真删」：立即从讯飞云端擦除，不可恢复</li>
                      <li>「仅本地隐藏」：本机 UI 不再显示，云端原样保留</li>
                    </ul>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {/* ConfirmModal 已上移到 App.tsx 内的 ConfirmHost 全局渲染器 */}
    </div>
  );
};
