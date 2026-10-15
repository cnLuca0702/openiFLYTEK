import React, { useState, useCallback } from 'react';
import { ConfirmModal } from './ConfirmModal';
import { emitConfirmResult, useConfirmStoreSubscription } from '../hooks/useConfirm';

/**
 * 全局唯一 ConfirmModal 渲染器：
 * useConfirm() 触发时把 action 放进全局 store；
 * ConfirmHost 监听 store 变化，把"最早的"action 渲染成 ConfirmModal；
 * ConfirmModal 的 onCancel/onConfirm 走 emitConfirmResult(key, ok) 把 Promise 完成。
 *
 * 这样可以保证：任何位置调 useConfirm() 都只弹一个 modal，没有重复 mount。
 */
export const ConfirmHost: React.FC = () => {
  const [current, setCurrent] = useState<{ key: string; action: any } | null>(null);

  useConfirmStoreSubscription(setCurrent);

  const handleCancel = useCallback(() => {
    if (current) emitConfirmResult(current.key, false);
  }, [current]);

  const handleConfirm = useCallback(() => {
    if (current) emitConfirmResult(current.key, true);
  }, [current]);

  if (!current) return null;

  return (
    <ConfirmModal
      isOpen={true}
      action={current.action}
      onCancel={handleCancel}
      onConfirm={handleConfirm}
    />
  );
};