# Replace every alert/confirm with a documented Toast + Confirm primitive

Written against: local working tree (HEAD commit unavailable)

## Evidence chain

- Surface: the desktop shell in [src/App.tsx](file:///Users/yaban/Desktop/WorkSpace/viaim-notebook-assistant/src/App.tsx), every overlay component under [src/components/](file:///Users/yaban/Desktop/WorkSpace/viaim-notebook-assistant/src/components/), and the dark/glassmorphism token system defined in [tailwind.config.js](file:///Users/yaban/Desktop/WorkSpace/viaim-notebook-assistant/tailwind.config.js) and [src/index.css](file:///Users/yaban/Desktop/WorkSpace/viaim-notebook-assistant/src/index.css).
- Problem: 14 `window.alert()` call sites across `src/App.tsx` and `src/components/NotebookHubModal.tsx`, plus 1 `window.confirm()` in `src/components/MeetingSidebar.tsx`. They render OS-native chrome that ignores the `viaind` token system, breaks reduced-motion expectations, and visually pulls the user out of the running task flow every time the product asks for confirmation.
- Design evidence: `src/components/ConfirmModal.tsx` already proves the team can build a `viaind`-themed dialog primitive. `tailwind.config.js` exposes the four semantic colors (`viaim.primary` indigo, `viaim.cyan` cyan, `viaim.emerald` emerald, `viaim.amber` amber) and three glow shadows (`glow-primary`, `glow-cyan`, `glow-red`) that the new primitive can reuse directly.
- Owner: `src/components/Toast.tsx` (new), `src/hooks/useToast.ts` (new), every existing call site that currently calls `alert()` or `confirm()`.
- Scope and affected surfaces:
  - New: `src/components/Toast.tsx`, `src/hooks/useToast.ts`.
  - Modified: `src/App.tsx`, `src/components/NotebookHubModal.tsx`, `src/components/MeetingSidebar.tsx`.
  - Reused surface: existing `src/components/ConfirmModal.tsx` (its public API stays stable; it becomes the renderer for the new `useConfirm` hook).
- Uncertainty: None. Every action's success/failure path already exists in code; this plan only swaps the rendering primitive.

## Design decision

Introduce one shared `ToastViewport` plus a `useToast()` hook that pushes typed toasts (success, info, warning, error, danger) onto a single mount point at the bottom-right of the desktop shell. Add a `useConfirm()` hook that returns a promise and reuses `ConfirmModal` as its renderer — `ConfirmModal`'s existing `onCancel` / `onConfirm` props and styling are kept exactly as they are; `useConfirm` only owns the promise lifecycle. Replace every `alert(msg)` call site with `toast.{severity}(msg, {title, duration})` and replace every `confirm(msg)` call site with `useConfirm({...ConfirmAction}).then(ok => ...)`. Errors keep their full multi-line technical message (including token/Auth prompts and OSS diagnostics) because the toast body uses the same fixed-height container and supports multi-line copy. Actions remain synchronous in their call sites; only the visual feedback primitive changes.

The `ToastViewport` is mounted once in `App.tsx` directly under the existing `<div className="flex flex-col h-screen ...">`, after the existing modals, so its z-index stack does not collide with the modal `z-50` or `z-60` layers.

## Reuse

- `viaind.bg`, `viaind.card`, `viaind.cardHover`, `viaind.border`, `viaind.borderLight` — surface chrome tokens.
- `viaind.primary`, `viaind.cyan`, `viaind.emerald`, `viaind.amber` — semantic severity tokens (matched 1:1 with the existing `ConfirmModal` variants).
- `shadow-glow-primary`, `shadow-glow-cyan`, `shadow-glow-red` — accent shadows for toast borders (mirrors `ConfirmModal.tsx` severity chrome).
- `src/components/ConfirmModal.tsx` — the existing modal. `useConfirm` resolves through it.
- New primitives required: `ToastViewport` and `useToast`. They cannot be expressed by the existing `ConfirmModal` because a toast is transient (auto-dismiss), positioned (overlay), and non-blocking (does not pause the user). `ConfirmModal` is the opposite on all three.
- Exemplar: `src/components/ConfirmModal.tsx` (severity chrome, prop wiring, body layout).

## Changes

1. `src/components/Toast.tsx` (new)
   - Change: export a `<ToastViewport>` component that renders a fixed-position container at `bottom-6 right-6 z-50`, holds a vertical stack of toast items, and auto-dismisses each toast after `duration` ms (default 3500). Each toast uses `bg-viaim.card/95 backdrop-blur-md`, severity-colored left border (3px), severity icon (lucide), title (textMain, bold), body (textMuted, optional). Export a typed `useToast()` hook that returns `{ success, info, warning, error, danger }`. Each method takes `body: string` and an optional `{ title?: string, duration?: number, action?: { label: string, run: () => void } }` payload. Reuse the same `severity-→-color` mapping that `ConfirmModal.tsx` uses.
   - Preserve: existing `ToastViewport` consumers; no change to existing components other than `App.tsx`.
   - Verify: open the app, trigger any error toast (e.g. trigger the "录音失败" error alert from `App.tsx` by denying microphone access once). Toast appears bottom-right, severity color border visible, body copy wraps to ≤3 lines, click ✕ closes immediately, auto-dismiss after 3.5s. Keyboard: `Esc` closes focused toast.

2. `src/hooks/useToast.ts` (new)
   - Change: export a tiny event-bus pattern using `window.dispatchEvent(new CustomEvent('viaim:toast', { detail: payload }))`. `ToastViewport` listens with a single mount-time `addEventListener`. Hook returns the bus methods.
   - Preserve: nothing — entirely new file.
   - Verify: two unrelated call sites triggering toasts in <100ms both render stacked, not collapsing into one.

3. `src/App.tsx`
   - Change:
     - Mount `<ToastViewport />` once, as the last child of the root layout `<div className="flex flex-col h-screen ...">` at [src/App.tsx:420](file:///Users/yaban/Desktop/WorkSpace/viaim-notebook-assistant/src/App.tsx#L420).
     - Replace the four `alert(...)` call sites:
       - L54: `alert('讯飞账号登录凭据已失效或 refreshToken 已过期，请重新登录')` → `toast.warning('请前往「办公本工作中心」重新登录讯飞账号。', { title: '登录凭据已失效', duration: 6000 })`.
       - L197: `alert(\`无法访问麦克风设备: ${err.message}\`)` → `toast.error(\`麦克风访问被拒绝。请在「系统设置 → 隐私与安全 → 麦克风」允许 VIAIM Studio。\n详情: ${err.message}\`, { title: '麦克风不可用', duration: 8000 })`.
       - L327: `alert(\`推送到智能办公本失败: ${...}\`)` → `toast.error(body, { title: '办公本推送失败', duration: 10000 })` with the same body string.
       - L359: `alert(\`删除失败: ${err.message}\`)` → `toast.error(\`删除失败: ${err.message}\`, { title: '本地删除失败' })`.
       - L416: `alert(\`导入失败: ${...}\`)` → `toast.error(\`导入失败: ${...}\`, { title: '导入办公本笔记失败' })`.
   - Preserve: every catch's `console.error(...)` log; the visual feedback channel is the only thing swapped.
   - Verify: deny microphone permission, observe warning toast with the 6000ms duration + log line in Console. Trigger any of the 5 alert replacements and observe the same log line + toast.

4. `src/components/NotebookHubModal.tsx`
   - Change: replace 10 `alert(...)` call sites:
     - L177: `alert(\`读取失败: ${e?.message}\`)` → `toast.error(\`读取失败: ${e?.message}\`, { title: '云端读取失败' })`.
     - L316/L336/L349 (the three "success" alerts) → `toast.success('已移入云端回收站', { duration: 2500 })` / `toast.success('已恢复', { duration: 2500 })` / `toast.success('已从云端删除', { duration: 2500 })`.
     - L318/L338/L351/L367/L403 (the 5 error alerts) → `toast.error(\`...: ${e?.message}\`, { title: '操作失败', duration: 6000 })`.
   - Preserve: every catch's `console.error` log.
   - Verify: delete a cloud note → success toast slides in for 2.5s, then auto-hides; the underlying UI list updates immediately. Now disable the network and retry → error toast appears for 6s with the failure message.

5. `src/components/MeetingSidebar.tsx`
   - Change: replace the existing `if (confirm(\`确定删除会议《${m.title}》吗？...\`))` with `const ok = await useConfirm({ title: '删除会议', scope: '本地 SQLite (kitdb.db)', target: m.title, consequence: '该会议记录将从本地数据库彻底删除，关联的转写/待办/录音一并清理。云端办公本不受影响。', typeToConfirm: 'DELETE', variant: 'danger', confirmText: '永久删除' }).then(r => r)`. If `ok` is true, call `onDeleteMeeting(m.id)`. Import `useConfirm` from a new `src/hooks/useConfirm.ts` (see Change 6).
   - Preserve: the existing `onDeleteMeeting` prop wiring and the surrounding card layout.
   - Verify: hover a meeting card, click the trash icon → `ConfirmModal` opens with red severity, requires typing `DELETE` to enable confirm, dismiss works with Esc. Original browser `confirm()` dialog is gone.

6. `src/hooks/useConfirm.ts` (new)
   - Change: export `useConfirm(action: ConfirmAction): Promise<boolean>`. Internally use the same event-bus pattern as `useToast`, but listen for resolution on a unique `confirmKey` (auto-generated `crypto.randomUUID()` stored in a closure). `ConfirmModal` is extended with one new optional prop: `resolver?: (ok: boolean) => void` and a generated `confirmKey`. When `useConfirm` triggers a confirm, it stores the resolver in a `Map<confirmKey, (ok: boolean) => void>`, then renders a `ConfirmModal` instance owned by a top-level `<ConfirmHost>` mounted in `App.tsx`. The host looks up the latest action and renders it. On confirm/cancel, the host resolves via the resolver map and clears the active action.
   - Preserve: `ConfirmModal`'s existing API (current call sites in `NotebookHubModal.tsx` still use the same prop wiring).
   - Verify: open the workspace hub → confirm a recycle action → dialog appears; cancel or confirm both close the dialog and resolve the promise correctly. The new meeting delete hook used above goes through the same host with no renderer closure code in `MeetingSidebar.tsx`.

## Scope

- Inherit: every existing alert/confirm call site listed above. Also inherit all five `ConfirmActions.*` factories in `src/components/ConfirmModal.tsx` — they remain the canonical list of severity + copy mappings; new call sites reuse them.
- Verify: every component that previously showed a native dialog (NotebookHubModal, MeetingSidebar, App) renders the new toast/confirm instead. Confirm: the dual-ConfirmModal mount that already exists in `NotebookHubModal.tsx` does not double up after the host lives in `App.tsx` — verify by inspecting the React tree and counting `ConfirmModal` instances in DevTools.
- Exclude: `<SuspendQuickWindow>` already uses inline UI for its status messages; leave it untouched. `<Header>` already uses inline status badges; leave untouched. `<AiSummaryPanel>` inline textareas already use the `viaind` design tokens; leave untouched. Error boundaries (`<ErrorBoundary>`) are not present; do not add one in this plan.

## Validation

- Product: every delete or call-to-action that previously popped an OS-native dialog now produces a `viaind`-themed toast or `ConfirmModal`. Visual identity stays consistent.
- Interface: test in two stages: (a) successful flow — delete a meeting → "本地删除成功" toast appears bottom-right, fades after 2.5s; (b) failure flow — disable the network and try to delete → red error toast appears for 6s with the diagnostic body. Test reduced-motion: `prefers-reduced-motion: reduce` should still show toast (no exit animation); auto-dismiss timing remains.
- System: confirm `useToast` event bus uses a single mount listener; confirm `useConfirm` host renders exactly one `<ConfirmModal>` at a time even if two `useConfirm` calls happen back-to-back. Confirm the existing `ConfirmModal` call site in `NotebookHubModal.tsx` still works (regression: only convert it if it currently renders correctly; do not double-mount).
- Repository: `cd /Users/yaban/Desktop/WorkSpace/viaim-notebook-assistant && grep -rn "window\.alert\|window\.confirm" src/` → only matches the `MeetingSidebar.tsx` cleanup comment (or zero matches if you also delete that comment). Exit code 0.

## Stop conditions

- Stop if `useConfirm` host creates a double `ConfirmModal` mount (the existing `NotebookHubModal.tsx` already has its own — refactor it to consume `useConfirm` rather than mounting its own second `ConfirmModal`, or you will see two dialogs).
- Stop if `useToast` events leak between mounts (the bus uses `window` events; on Electron hot-reload, stale listeners can persist — verify by running `npm run build && open via "VS Code > WorkSpace"` and confirming no duplicate toasts).
- Stop if any of the existing `ConfirmActions.*` factories no longer match the actual user-facing copy (they came from `NotebookHubModal.tsx`; do not modify their text in this plan).

## Design documentation

- After acceptance and validation: add a new section to a future `DESIGN.md` at the repo root recording the `ToastViewport` + `useToast()` + `useConfirm()` primitives, their severity mapping (matches `ConfirmActions`), and the rule "no `alert()` / `confirm()` in product source — use `useToast` or `useConfirm` instead." The plan executor does not create this file in this PR; record it as an acceptance-time follow-up.