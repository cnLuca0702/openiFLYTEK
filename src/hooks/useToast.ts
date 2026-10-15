/**
 * 全局 Toast 事件总线（基于 window CustomEvent）
 * 任何位置调用 useToast() 都能 push 一个 viaind 主题通知
 */
import { useEffect, useState, useCallback, useMemo } from 'react';

export type ToastSeverity = 'success' | 'info' | 'warning' | 'error' | 'danger';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastPayload {
  id: string;
  severity: ToastSeverity;
  title?: string;
  body: string;
  duration?: number;
  action?: ToastAction;
}

export interface ToastInput {
  body: string;
  title?: string;
  duration?: number;
  action?: ToastAction;
}

const EVENT_NAME = 'viaim:toast';

function publish(payload: ToastPayload) {
  const ev = new CustomEvent<ToastPayload>(EVENT_NAME, { detail: payload });
  window.dispatchEvent(ev);
}

export function useToast() {
  const push = useCallback((severity: ToastSeverity, body: string, opts: Omit<ToastInput, 'body'> = {}) => {
    const id =
      (typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
    publish({
      id,
      severity,
      body,
      title: opts.title,
      duration: opts.duration,
      action: opts.action
    });
  }, []);

  // 稳定引用：避免消费方把 toast 放进 useEffect/useCallback 依赖时引发无限重渲染
  return useMemo(() => ({
    success: (body: string, opts?: Omit<ToastInput, 'body'>) => push('success', body, opts),
    info: (body: string, opts?: Omit<ToastInput, 'body'>) => push('info', body, opts),
    warning: (body: string, opts?: Omit<ToastInput, 'body'>) => push('warning', body, opts),
    error: (body: string, opts?: Omit<ToastInput, 'body'>) => push('error', body, opts),
    danger: (body: string, opts?: Omit<ToastInput, 'body'>) => push('danger', body, opts)
  }), [push]);
}

/** 单例订阅 hook — 给 ToastViewport 内部用（监听 publish 派发的 CustomEvent） */
export function useToastSubscription(setState: (updater: (prev: ToastPayload[]) => ToastPayload[]) => void) {
  useEffect(() => {
    const handler = (ev: Event) => {
      const payload = (ev as CustomEvent<ToastPayload>).detail;
      if (payload) setState((prev) => [...prev, payload]);
    };
    window.addEventListener(EVENT_NAME, handler);
    return () => {
      window.removeEventListener(EVENT_NAME, handler);
    };
  }, [setState]);
}