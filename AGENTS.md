# viaim-notebook-assistant — 项目记忆

> 本文件供后续会话/Agent 快速了解项目已确认的关键变更与不可回退的约束。
> 详细实施记录见 `design-plans/03-office-notebook-cloud-integration-handoff-plan.md`。

## 2026-10-15 云笔记「录音下载 + 播放」链路修复（已生效，已验证）

**结论**：办公本云笔记的录音现在可以正常下载并在应用内播放。

**改动文件**
- `server/record_parser.js`（新增：笔记详情/转写解析）
- `server/notebook_integration_service.js`（下载与导入编排）
- `server/media_stream.js`（HTTP Range 流播）
- `server/storage_paths.js`（项目自有缓存目录 + 路径防穿越）
- `server/notebook_store.js`（项目自有 `notebook.db`）
- `server/db_service.js`（官方库改为只读）
- `server/server.js`（下载 / 音频流 / 导入路由）
- `src/services/api.ts`（`downloadNotebookNote` / `importNotebookNote`）
- `src/components/TranscriptionWorkspace.tsx`（原生 `<audio>` 播放器）

**必须保持的不变量（改动前先读 design-plans/03）**
1. VIAIM 官方 `kitdb.db` 只读（`readOnly: true`）；项目数据一律写入
   `~/Library/Application Support/VIAIM Studio/notebook-store/notebook.db`。
2. 音频下载参数：`dir: 'shorthand'`, `increment: 1`；转写下载：`dir: 'attachment'`, `increment: 0`。
3. 音频落盘后必须做 `OggS` 文件头校验（`assertOggOpus`），非 Ogg Opus 直接报 `INVALID_AUDIO_FORMAT`。
4. 临时 OSS 签名 URL **绝不下发前端、绝不入库**；前端只使用 `/api/notebook/notes/:id/audio`。
5. 播放走 `streamLocalMedia` 的 HTTP Range（206），`Content-Type: audio/ogg; codecs=opus`。
6. 转写解析规则：除说话人标记（`0x6xxxxxxx`，含 `1610612737`）外的有文本条目一律视为转写文字，
   以兼容未开启说话人分离的 `type=1` 条目（否则整篇转写会变成 0 句）。
7. 列表/详情中的 `meetingId` 需 URL 编码；导入为幂等操作，键为 `notebook:{noteId}`。
