/**
 * 全局 Confirm Promise hook：把 ConfirmModal 二次确认封装为 Promise
 *
 * 架构：
 *   1. useConfirm() 返回 confirm(action): Promise<boolean>
 *   2. confirm() 把 {key, action, resolve} 塞入全局 pending map
 *   3. ConfirmHost 监听 toConfirm 状态变化，把当前 action 渲染成 ConfirmModal
 *   4. ConfirmModal 的 onConfirm/onCancel 调用 emitConfirmResult(key, ok)
 *   5. confirm() 的 Promise 收到结果后清理并 resolve
 */
import { useCallback, useEffect } from 'react';
import { ConfirmAction } from '../components/ConfirmModal';

interface PendingItem {
  key: string;
  action: ConfirmAction;
  resolve: (ok: boolean) => void;
}

const STORE_KEY = '__viaim_confirm_pending__';

interface ConfirmWindow extends Window {
  [STORE_KEY]?: Map<string, PendingItem>;
}

function getStore(): Map<string, PendingItem> {
  const w = window as ConfirmWindow;
  if (!w[STORE_KEY]) w[STORE_KEY] = new Map<string, PendingItem>();
  return w[STORE_KEY];
}

export function useConfirm() {
  return useCallback((action: ConfirmAction): Promise<boolean> => {
    const key =
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    return new Promise<boolean>((resolve) => {
      getStore().set(key, { key, action, resolve });
      // 触发 host 重渲染
      window.dispatchEvent(new CustomEvent('viaim:confirm:request', { detail: { key } }));
    });
  }, []);
}

/** ConfirmHost 拿到 ok 时调用：resolve Promise 并清理 */
export function emitConfirmResult(key: string, ok: boolean) {
  const store = getStore();
  const item = store.get(key);
  if (item) {
    item.resolve(ok);
    store.delete(key);
  }
  // 通知 host 关闭（即使没有挂载的也不报错）
  window.dispatchEvent(new CustomEvent('viaim:confirm:resolve', { detail: { key } }));
}

/** ConfirmHost 订阅 store 变化 */
export function useConfirmStoreSubscription(
  onChange: (current: PendingItem | null) => void
) {
  useEffect(() => {
    const refresh = () => {
      const store = getStore();
      // 取最早插入的（保持数组语义保证）
      const first = store.size > 0 ? Array.from(store.values())[0] : null;
      onChange(first);
    };
    refresh();
    const onRequest = () => refresh();
    const onResolve = () => refresh();
    window.addEventListener('viaim:confirm:request', onRequest);
    window.addEventListener('viaim:confirm:resolve', onResolve);
    return () => {
      window.removeEventListener('viaim:confirm:request', onRequest);
      window.removeEventListener('viaim:confirm:resolve', onResolve);
    };
  }, [onChange]);
}