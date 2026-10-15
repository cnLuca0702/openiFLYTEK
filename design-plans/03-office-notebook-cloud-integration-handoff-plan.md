# 办公本云笔记集成实施交接计划

> **状态：已批准，待实施**  
> **更新日期：2026-10-15**  
> **适用项目：** `viaim-notebook-assistant`  
> **目标应用证据源：** `/Applications/读写笔记.app`（`com.iflytek.Doxent` 5.0.7）  
> **实施前置：** 本计划已完成只读逆向和云端查询取证。实施者应遵守此计划；除本文明确的一次性迁移外，不得修改 VIAIM 官方数据库。

---

## 实施进度（2026-10-15）

### 本轮已完成并验证

- [x] 新建项目自有 `notebook.db`、缓存、录音和备份目录：`~/Library/Application Support/VIAIM Studio/notebook-store/`。
- [x] 将常态 `kitdb.db` 连接改为 `readOnly: true`；新本地录音和办公本导入均写入项目自有存储。
- [x] 实现 `shorthand + increment=1` 的 Ogg Opus 下载、分片合并、`OggS` 文件头校验、转写下载和说话人/标点解析。
- [x] 实现项目本地 Ogg Opus Range 流：真实验证为 `206 Partial Content`、`Content-Type: audio/ogg; codecs=opus`、文件头 `OggS`。
- [x] 前端导入路径改为“下载并校验 → 幂等导入”，播放器只使用本地 API 地址，不再持久化或拼接临时 OSS URL。
- [x] 实现统一会议列表，支持只读 VIAIM 记录和项目自有会议共同展示；外部 VIAIM 记录的删除与待办写入在 UI/API 层均被阻止。
- [x] 盘点旧错误办公本导入：共 **8** 条，其中 **4** 条仍显示、**4** 条已软删除；本轮没有修改这些旧记录。
- [x] 运行 `npm run build`、全量服务端语法检查、隔离多分片模拟和真实云端录音下载/Range 测试。

### 后续尚未实施（必须继续遵循本计划）

### 2026-10-15 14:05 补充修复：播放按钮无法点击

- 根因 1：列表顶部 4 条旧版 `[办公本]` 记录写在 VIAIM 官方库且无录音，按钮必然禁用。现由 `GET /api/meetings` 在显示层隐藏（`?includeLegacy=1` 可查看），**未修改官方库**；正式清理仍走历史迁移流程。
- 根因 2：未开启说话人分离的录音笔记，转写条目为 `type=1`，旧解析器只认 `1073741825`，导致整篇转写为 0 句。`server/record_parser.js` 已改为“除说话人标记（`0x6xxxxxxx`）外的有文本条目均为转写”。
- 其他：`getMeetingDetail` 对 ID 做 URL 编码；无录音时播放器显示原因提示。
- 验证：在 Electron 真实界面中点击“浙大科研交流”（3122.88 s，1324 句）与“2026-01-27 14:32:07”（2117.76 s，898 句），按钮可用且音频实际播放。

- [ ] 在办公本中心增加“修复历史导入”UI：逐条选择旧记录对应的 `noteId`，展示替代验证信息；不得自动猜测映射。
- [ ] 仅在每条替代会议已验证后，调用受控迁移服务备份 `kitdb.db` 并设定旧记录 `DELETE_FLAG=1`；当前仅实现了候选清单和迁移服务，未暴露任何自动删除入口。
- [ ] 实现首次全量索引后的增量同步、下载队列并发/进度/取消、手写页图和 AI 速览。
- [ ] 为当前已打开的 Electron 窗口刷新/重启前端，或重新打包应用，以加载本轮生成的 `dist/` 前端资源。

---

## 1. 已确认且不可重新讨论的决策

| 决策 | 已确认的选择 | 必须落实的工程含义 |
|---|---|---|
| 存储边界 | **办公本云笔记、附件、导入记录全部存入本项目自有存储** | `kitdb.db` 只读；不得再向其插入、更新或删除常规业务数据。 |
| 音频缓存 | **使用项目自有缓存目录** | 不复用、也不依赖 `/Users/yaban/Library/Application Support/doxent` 的缓存结构。 |
| 历史错误记录 | **先成功重新导入，再删除已有 8 条错误导入记录** | 新记录必须先通过音频、转写和时长验收；旧记录的删除采用可恢复的 `DELETE_FLAG=1` 软删除，并在迁移前创建可验证备份。 |

### 1.1 已批准的一次性例外：旧记录软删除

当前项目曾经写入 VIAIM 官方数据库：

```text
/Users/yaban/Library/Preferences/com.viaim.vi/kitdata/db/kitdb.db
```

本次迁移**唯一允许的写入**是：在完成替代记录的验证之后，对已确认的 8 条错误 `[办公本]` 记录设定 `DELETE_FLAG=1`。这让它们不再在 VIAIM 中显示，但仍可从备份恢复；不执行 `DELETE FROM t_record`，也不立即物理删除句子或待办。

> 不得通过标题或时间“猜测”云笔记与旧记录之间的对应关系。因为旧记录没有保存 `noteId`，自动映射不可靠。迁移 UI 必须让用户为每条旧记录明确选择替代的云笔记，或者明确选择不迁移而保留。

---

## 2. 已验证的技术事实（不得在实现中重新假设）

### 2.1 真实录音下载协议

从官方客户端和实际账号的只读测试验证：

| 项目 | 正确行为 | 错误行为（当前项目） |
|---|---|---|
| 录音对象目录 | `dir: "shorthand"` | `dir: "attachment"` |
| 下载分片参数 | `increment: 1` | `increment: 0` |
| 成功判断 | `json.data.code === true` | 只接受 HTTP 成功或假定 `code===200` |
| 返回地址 | `json.data.url`，数组 | 假定单个 URL |
| 多分片录音 | 按返回顺序下载、逐段二进制拼接 | 只使用第一个 URL |
| 本地结果 | 标准 **Ogg Opus** 文件 | 误当作 mp3/wav 或依赖临时 OSS URL |

样本笔记 `9949ca6d222147f78338e60753bc0ed1` 已实测：

- `shorthand + increment=1` 成功，返回 Ogg Opus；
- Range `bytes=0-63` 响应为 `206`，文件头为 `OggS`；
- 录音为单声道 Ogg Opus，时长 `2117.76s`；
- `audioDuration` 是**毫秒字符串**（`"2117760"`），不应再乘 1000；
- Electron/Chromium 可原生播放该格式，不需要为播放而转码。

### 2.2 真实笔记字段与附件

| 信息 | 真实位置 / 获取方式 | 实现要求 |
|---|---|---|
| 笔记标题 | `detail.noteName`，其次 `content.noteInfo.name` | 不使用不存在的 `detail.title` 作为主字段。 |
| 录音文件名 | `content.audio.audioPath` | 仅作为缓存相对路径/对象名；禁止直接当网络 URL。 |
| 录音时长 | `content.audio.audioDuration` | 用 `Number(...)` 作为毫秒。 |
| 逐句转写 | `content.text.onlineTransferTextPath`，从 `attachment` 下载 | JSON 数组；解析 `beginTimeMills`、`endTimeMills`、`content`、`type`、`segment`。 |
| 说话人切换 | 转写条目 `type === 1610612737` | 对后续正文句子生效，不作为普通正文。 |
| 正文句子 | 转写条目 `type === 1073741825` | 生成可点击定位的句子。 |
| 手写页面 | `record.pageList[].pngPath`、`imageList[].imagePath`，目录 `image` | 阶段 3 按需下载。 |
| AI 速览 | `content.reqId` → `getNoteModuleTask(reqId, "quickLook")` | 阶段 3 可选，失败不得影响笔记或音频可用性。 |

### 2.3 当前项目中已确认的问题

1. `server/iflytek_client.js:getNoteDetail()` 用错下载目录和 `increment`；所以 `audioUrl` 为空。
2. `src/components/TranscriptionWorkspace.tsx` 总将 `meeting.audioUrl` 拼接到 `http://localhost:3800`；绝对 URL 会变成非法 URL。
3. `db_service.createRecordedMeeting()` 会把临时 OSS 签名 URL 存为音频路径；签名过期后不可播放。
4. 本地 `/api/audio/:id` 只识别 mp3/wav，不支持 Opus，也没有正确设置 `audio/ogg; codecs=opus`。
5. `getNoteDetail()` 误从 `record.pageList[].blocks` 取转写；真实转写在独立 `.txt` 附件。
6. 导入时将已是毫秒的 `audioDuration` 再乘了 1000。
7. 现有办公本导入路径会写入 VIAIM `kitdb.db`，与已批准的架构相冲突。
8. 当前已有 8 条错误 `[办公本]` 导入记录：没有有效音频路径，部分时长错误或为固定 15 分钟，并且无 `noteId` 映射。

---

## 3. 目标架构

```text
讯飞云 API / OSS
      │   鉴权、签名、可刷新的 userToken
      ▼
server/iflytek/
  ├─ gateway.js              请求签名、应用令牌、401 刷新、脱敏日志
  ├─ notes_client.js         笔记/目录/标签/回收站/分享等云端 API
  ├─ attachment_client.js    下载地址申请、分片下载、二进制拼接、原子落盘
  └─ record_parser.js        标题、时长、转写、说话人、标点归并解析
      │
      ▼
项目自有数据目录（macOS）
~/Library/Application Support/VIAIM Studio/notebook-store/
  ├─ notebook.db             云笔记索引、转写、导入映射、下载状态
  ├─ cache/<userId>/<noteId>/res/
  │   ├─ <audioPath>.opus
  │   ├─ <audioPath>.opus.parts.json
  │   ├─ transfer.json
  │   └─ page/...
  └─ backups/                迁移前的 kitdb 数据库备份及迁移清单
      │
      ▼
Express API（只提供本地稳定地址）
  GET  /api/notebook/notes
  POST /api/notebook/notes/:noteId/download
  GET  /api/notebook/notes/:noteId/audio
  POST /api/notebook/notes/:noteId/import
  POST /api/notebook/legacy-imports/:legacyId/replace
      │
      ▼
React / Electron
  - 列表显示同步、下载、缓存和导入状态
  - 播放器仅请求本地 `/api/.../audio`
  - 失败时展示具体阶段和可重试操作
```

### 3.1 路径约定

服务端可独立运行，因此不能直接调用 Electron `app.getPath()`。创建 `server/storage_paths.js`：

```js
const APP_DATA_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'VIAIM Studio');
const NOTEBOOK_STORE_DIR = path.join(APP_DATA_DIR, 'notebook-store');
const NOTEBOOK_DB_PATH = path.join(NOTEBOOK_STORE_DIR, 'notebook.db');
const NOTEBOOK_CACHE_DIR = path.join(NOTEBOOK_STORE_DIR, 'cache');
const NOTEBOOK_BACKUP_DIR = path.join(NOTEBOOK_STORE_DIR, 'backups');
```

要求：所有目录创建由该模块负责；**绝对路径不能进入 git**；每个缓存目标必须用 `safePathSegment` 校验 `userId`、`noteId` 和文件名，拒绝路径穿越。

### 3.2 数据边界与 API 边界

| 数据来源 | 允许操作 | 约束 |
|---|---|---|
| VIAIM `kitdb.db` | 读取会议；仅迁移完成后软删除明确选定的 8 条旧记录 | 常态用 `readOnly: true` 打开，不得插入新会议。 |
| 项目 `notebook.db` | 读写云笔记元数据、附件状态、转写、导入会议和映射 | 这是办公本导入能力唯一的写入库。 |
| 云端笔记 | 调用用户已有账号授权的接口 | 删除、回收、恢复必须继续走二次确认 UI；本计划不改变其云端语义。 |
| OSS | 使用临时签名 URL 下载到项目缓存 | 临时 URL 只在内存中使用且日志脱敏，禁止持久化。 |

---

## 4. 本地库设计

使用 Node 内置 `node:sqlite`（项目现有依赖方式），单独实现 `server/notebook_store.js`。所有 schema 建表使用 `CREATE TABLE IF NOT EXISTS`，并执行 `PRAGMA journal_mode=WAL`、`PRAGMA foreign_keys=ON`。

### 4.1 最小 schema

```sql
CREATE TABLE IF NOT EXISTS cloud_note (
  note_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type INTEGER NOT NULL,
  note_name TEXT,
  dir_id TEXT,
  dir_name TEXT,
  is_encrypt INTEGER NOT NULL DEFAULT 0,
  remote_create_time INTEGER,
  remote_sync_time INTEGER,
  remote_version TEXT,
  audio_object_name TEXT,
  audio_duration_ms INTEGER,
  transcript_object_name TEXT,
  detail_json TEXT,
  downloaded_at INTEGER,
  download_state TEXT NOT NULL DEFAULT 'not_downloaded',
  download_error_code TEXT,
  download_error_message TEXT,
  download_error_stage TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS cloud_sentence (
  note_id TEXT NOT NULL REFERENCES cloud_note(note_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  segment INTEGER,
  speaker TEXT,
  begin_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY(note_id, ordinal)
);

CREATE TABLE IF NOT EXISTS imported_meeting (
  meeting_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL UNIQUE REFERENCES cloud_note(note_id),
  title TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  audio_relative_path TEXT,
  imported_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS legacy_replacement (
  legacy_meeting_id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL UNIQUE REFERENCES cloud_note(note_id),
  replacement_meeting_id TEXT NOT NULL REFERENCES imported_meeting(meeting_id),
  verification_json TEXT NOT NULL,
  backed_up_at INTEGER NOT NULL,
  legacy_soft_deleted_at INTEGER,
  status TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloud_note_user_synctime
  ON cloud_note(user_id, remote_sync_time DESC);
CREATE INDEX IF NOT EXISTS idx_sentence_note_time
  ON cloud_sentence(note_id, begin_ms);
```

设计规则：

- `detail_json` 保存原始详情快照，仅用于兼容和排障；UI 不能直接依赖其不稳定结构。
- `download_state` 枚举：`not_downloaded | downloading | ready | failed | partial`。
- `download_error_stage` 枚举：`detail | get_url | download_part | merge | validate | transcript`。
- `audio_relative_path` 必须相对于 `NOTEBOOK_CACHE_DIR`，绝不保存签名 URL。
- 导入会议 `meeting_id` 使用 `notebook:<noteId>`，以免与 VIAIM 原始 ID 冲突。

---

## 5. 实施顺序与文件级任务

> 每一阶段结束都必须运行该阶段的验证，不要把所有变更累积到最后才测试。

### 阶段 0：建立安全护栏和测试基线

**目标：** 先阻断对第三方数据库的常规写入，并提供稳定的本地存储入口。

| 文件 | 变更 |
|---|---|
| `server/storage_paths.js`（新建） | 实现数据目录、缓存目录、备份目录、路径校验和目录初始化。 |
| `server/notebook_store.js`（新建） | 实现 4.1 schema、迁移初始化、事务包装和基础 CRUD。 |
| `server/db_service.js` | 拆分为 `viaim_read_service.js`（所有常规连接 `readOnly:true`）与新存储服务；移除/弃用 `createRecordedMeeting` 对 `kitdb.db` 的写入路径。 |
| `server/server.js` | 在启动时初始化项目存储；启动日志只输出项目自身存储路径，不暴露 token/签名 URL。 |
| `src/types/index.ts` | 为 `Meeting` 加入来源（`viaim | notebook`）或创建显式 DTO；不要再通过 URL 是否 http 来推断来源。 |

**必须验证：**

1. 启动服务后创建项目目录和 `notebook.db`，不创建/修改 `kitdb.db`。
2. 将 `kitdb.db` 的文件校验摘要（或 mtime + 只读连接）与启动前相比，常态运行无变化。
3. 原有 VIAIM 会议仍能只读显示。

### 阶段 1：实现可靠附件下载与音频流

**目标：** 让一篇录音笔记在重启、临时 URL 过期和断网时仍可播放。

| 文件 | 变更 |
|---|---|
| `server/iflytek_client.js` 或拆分后的 `attachment_client.js` | 新增 `downloadAttachment({noteId, userId, dir, objectName, increment, destination})`；录音固定使用 `shorthand + increment:1`。 |
| 同上 | `getDownloadUrl` 正确接受成功字段 `data.code === true`，将 URL 标准化为数组，http 强制升级到 https。 |
| 同上 | 多分片顺序下载到同一 note 缓存目录的临时 `part_*` 文件，二进制 append；仅合并成功后通过原子 rename 发布 `.opus`。 |
| 同上 | 下载时不把签名 URL 写入数据库或日志；最多记录已脱敏主机与状态码。 |
| `server/media_stream.js`（新建） | 安全的 Range 解析、`206/416`、`Accept-Ranges`、`Content-Length`、`Content-Range`、`Content-Type: audio/ogg; codecs=opus`。 |
| `server/server.js` | 新增 `POST /api/notebook/notes/:noteId/download`、`GET /api/notebook/notes/:noteId/audio` 和下载状态接口。音频未缓存时可触发一次下载并返回 `409` + `download_state`；不要让一个播放器请求无限期阻塞。 |

**下载实现细节：**

1. 先从云端详情取得 `content.audio.audioPath`。
2. 请求 `{ userId, dir: 'shorthand', objectName: audioPath, expiration: 86400, increment: 1 }`。
3. 对返回的每个 URL：用流式 `fetch` 写 `part_<ordinal>.down` → 完成后原子 rename 为 `part_<ordinal>`；必须检查 2xx、大小（若提供 `Content-Range/Content-Length`）和 `OggS` 文件头。
4. 单段直接发布，分段按**返回数组顺序** append；写 `<audioPath>.parts.json`，包含分片数量、大小、完成时间和输入校验摘要。
5. 对合并结果验证首 4 字节为 `OggS`，否则状态改为 `failed/validate`；保留原子发布前的临时文件供一次重试使用。
6. 缓存命中时不重新请求云端；提供显式“重新下载”操作覆盖缓存。

**必须验证：**

- 使用已验证的样本 `9949ca6d222147f78338e60753bc0ed1`，下载文件头为 `OggS`，并且 `ffprobe` 可读取。
- 浏览器请求 `Range: bytes=0-63` 返回 206 和正确 `Content-Range`。
- 浏览器请求越界 Range 返回 416。
- 服务重启、模拟 OSS 链接过期、断网三种情形下，已完成缓存仍能播放。
- 将多分段下载逻辑用 fixture 覆盖（至少 3 段按顺序拼接和其中一段失败）。

### 阶段 2：正确解析详情、转写和导入会议

**目标：** 使导入后的本地会议有正确的名称、时长、转写和可播放本地音频，而不触碰 VIAIM 数据库。

| 文件 | 变更 |
|---|---|
| `server/record_parser.js`（新建） | `parseRecordDetail`、`parseTranscript`、`mergeLeadingPunctuation`、`chooseNoteTitle`。 |
| `server/iflytek_client.js` | `getNoteDetail` 返回结构化的云端详情摘要；不要返回或持久化 `audioUrl` 签名链接。 |
| `server/notebook_store.js` | 原子写入 note 详情、句子、下载状态与导入会议映射。 |
| `server/server.js` | `POST /api/notebook/notes/:noteId/import` 实现幂等导入；若还未下载，返回明确的 `409 AUDIO_NOT_READY`，由 UI 先下载再导入。 |
| `src/services/api.ts` | 定义 `NotebookNoteDetail`、下载状态、`importNotebookNote()`；删除 `as any`。 |
| `src/App.tsx` | 替换当前 `saveRecordedMeeting(... audioUrl ...)` 导入路径，采用“详情 → 下载 → 导入”流程，显示阶段进度。 |

**转写算法：**

```text
speaker = '说话人 1'（默认）
for item in transcript JSON array:
  if item.type === 1610612737:
    speaker = normalizeSpeaker(item.content)
  else if item.type === 1073741825 and item.content.trim() !== '':
    追加 { speaker, beginMs, endMs, text, segment }
最后：将某句开头的中文/英文标点拼到上一条正文末尾
```

**必须验证：**

- 样本转写中，903 条正文和 110 个说话人标记的语义可正确区分；说话人不能显示成普通字幕行。
- 样本导入会议时长为 `2,117,760 ms`（±1 秒），不能出现 `3,122,880,000 ms` 级错误。
- 标题优先显示 `noteName`。
- 同一个 `noteId` 反复导入不生成多个 `imported_meeting`；返回已有会议或选择更新其元数据。
- 新导入会议可在统一会议列表显示，点击句子可使用 `beginMs/1000` 定位本地音频。

### 阶段 3：改造播放 UI 与统一会议列表

**目标：** 前端不再假设远程音频 URL，也不再对 URL 作错误拼接。

| 文件 | 变更 |
|---|---|
| `src/components/TranscriptionWorkspace.tsx` | `audio.src` 改成明确的本地 API 路径。只为相对 `/api/` 路径加 `http://localhost:3800`；更优方案是在 Vite/Electron 中集中定义 `SERVER_ORIGIN`。 |
| 同上 | 增加 `onError`：显示音频错误码、下载状态和“重试下载”按钮；禁止只 `console.warn`。 |
| 同上 | `onLoadedMetadata` 读取实际时长；当元数据不可用时显示持久化的时长作为后备。 |
| `src/components/NotebookHubModal.tsx` | 每条笔记显示 `未下载 / 下载中 / 已缓存 / 下载失败`，提供下载、重试、导入操作，不将“导入中”伪装成“下载成功”。 |
| `src/App.tsx` 与 `src/services/api.ts` | 列表合并 `viaim`（只读）和 `notebook`（项目库）记录；所有会议 id 带来源命名空间。 |
| `src/types/index.ts` | 明确 `source`、`audioState`、`audioUrl`（只能是本地 API 地址）与 `cloudNoteId`。 |

**必须验证：**

- 新导入的会议播放器 URL 为 `http://localhost:3800/api/notebook/notes/<encoded-noteId>/audio`，不是 `http://localhost:3800https://...`。
- 播放、暂停、拖动、1x/1.25x/1.5x/2x 倍速和句子定位全部正常。
- 下载失败时 UI 告诉用户阶段（申请地址、下载分段、合并、校验或转写），并可安全重试。
- 已有 VIAIM 本地 mp3/wav 会议仍可播放，回归无破坏。

### 阶段 4：增量同步与云端管理

**目标：** 让云端笔记的使用和管理不再是每次全量即时请求。

| 领域 | 任务 |
|---|---|
| 索引同步 | 首次全量同步；之后使用 `remote_sync_time/syntime` 缓存和增量更新。UI 列表来自本地库，支持本地分页、搜索、类型/目录/下载状态筛选。 |
| 下载任务 | 并发最多 2；状态持久化；允许取消与重试；服务重启时把 `downloading` 恢复为 `partial`。 |
| 目录、标签 | 读取和展示目录/标签，云端写操作显示成功/失败并主动刷新相关本地索引。 |
| 回收站与删除 | 云端软删除、恢复、永久删除必须保留二次确认；只有用户确认后调用。 |
| FilePort | 保持现有“投递会议纪要到办公本”的能力，但导出源切换为统一会议 DTO。 |
| 可选导出 | 直接导出原始 `.opus`；MP3 导出使用系统 ffmpeg 或项目受控工具，不能依赖修改官方应用。 |

**验收：** 280 篇笔记在首次同步后可本地分页；第二次同步不逐篇重新下载详情；服务重启后队列状态和已缓存内容一致。

### 阶段 5：历史错误记录迁移与软删除

**目标：** 用已验证的项目自有会议替代旧的 8 条错误记录，然后按照用户已批准的决策隐藏旧记录。

#### 5.1 必须实现的迁移 UI / API

1. `GET /api/notebook/legacy-imports`：列出候选旧记录（限定 `TITLE LIKE '[办公本]%'` 且音频为空/不合法），返回 `legacyMeetingId`、标题、创建时间、时长、旧音频路径和软删除状态。
2. 在办公本中心新增“修复历史导入”入口：每一条旧记录可以选择一个云笔记；一条云笔记只能匹配一个旧记录。
3. 选定后，执行：详情同步 → 附件下载 → 本地导入 → 音频/转写/时长校验 → 建立 `legacy_replacement` 记录。
4. UI 必须显示精确的“将被隐藏的 VIAIM 记录”与“将替代它的项目记录”，然后执行已批准的软删除。迁移任务失败时不改变旧记录。

#### 5.2 删除前不可跳过的检查

```text
新 imported_meeting 已存在
AND cloud_note.download_state = 'ready'
AND 本地 .opus 存在、非零、首部为 OggS
AND cloud_sentence 至少有一条正文，或明确标记该云笔记无转写
AND duration_ms > 0
AND legacy_replacement 已保存备份和 verification_json
```

#### 5.3 备份、软删除和回滚

1. 迁移第一步用 SQLite `VACUUM INTO` 或等效一致性副本，备份 `kitdb.db` 到 `NOTEBOOK_BACKUP_DIR/kitdb-before-legacy-migration-<timestamp>.db`。
2. 将迁移候选清单、旧行摘要、替换 noteId 和音频校验信息写入 `legacy_replacement.verification_json`。
3. **只执行** `UPDATE t_record SET DELETE_FLAG = 1 WHERE ID = ?`，禁止级联物理删除 `t_sentence`/`t_record_todo`。
4. 回滚流程：用户选择“恢复旧记录”时，设 `DELETE_FLAG = 0`；是否删除项目自有替代记录由用户另行选择。

> 现有 `dbService.deleteMeeting()` 会额外删除关联句子和待办，迁移代码**不得调用该方法**。

**验收：** 8 条选定旧记录都先出现可播放的替代记录，之后才在 VIAIM 列表中隐藏；备份文件存在且可打开；任意一条迁移失败，旧记录仍完整可见。

---

## 6. API 契约（实施者必须稳定维护）

### 6.1 读取详情

```http
GET /api/notebook/notes/:noteId
```

成功响应中的 `audio` 不含签名链接：

```json
{
  "code": "000000",
  "data": {
    "noteId": "...",
    "noteName": "会议名称",
    "type": 2,
    "durationMs": 2117760,
    "audio": {
      "state": "ready",
      "objectName": "xxx.opus",
      "localUrl": "/api/notebook/notes/.../audio"
    },
    "sentences": []
  }
}
```

### 6.2 发起下载

```http
POST /api/notebook/notes/:noteId/download
Content-Type: application/json

{ "force": false, "includeTranscript": true }
```

- `202`：已进入下载或正在下载；返回 job/state。
- `200`：缓存已经可用。
- `401`：账号失效，前端通过现有 `tokenExpired` 机制要求重新登录。
- `409`：笔记不包含录音或当前状态不允许下载。
- `502`：云端/OSS 阶段失败，`detail.stage` 必须存在且是上述枚举。

### 6.3 播放音频

```http
GET /api/notebook/notes/:noteId/audio
Range: bytes=0-
```

- 已缓存：`200/206`，`Content-Type: audio/ogg; codecs=opus`。
- 未缓存：`409` JSON，附 `download_state`；前端据此触发下载，不执行盲目重放。
- 无效 range：`416`，带 `Content-Range: bytes */<size>`。

### 6.4 幂等导入

```http
POST /api/notebook/notes/:noteId/import
```

- `200`：返回既有或新建的 `meetingId: "notebook:<noteId>"`。
- `409 AUDIO_NOT_READY`：音频笔记未完成下载。
- 导入绝不写 VIAIM `kitdb.db`。

---

## 7. 测试策略与完成标准

### 7.1 自动化测试最低集合

| 类别 | 用例 |
|---|---|
| 单元 | `getDownloadUrl` 的真假 `code`、单/多 URL、URL https 规范化、路径穿越拒绝、Range 解析、OggS 魔数、转写说话人切换、标点归并、时长单位。 |
| 集成 | 用 mock OSS 测试单段和三段合并，失败清理、断点重试及 `parts.json`。 |
| 只读真实验证 | 扩展 `.work/diag/probe_audio.mjs`，抽取至少 5 篇 type=2 笔记，检查下载结果、OggS、ffprobe 时长和云端时长。该脚本不得执行云端写操作。 |
| API | 下载、音频 200/206/409/416、幂等导入、`kitdb.db` 常态只读行为。 |
| E2E | 导入→播放→拖动→倍速→点击句子定位→重启服务→断网后播放已缓存录音。 |
| 迁移 | 成功时旧记录软删除；任一校验失败时旧记录不变；备份可恢复。 |

### 7.2 Definition of Done

以下全部满足才算完成：

- [ ] 新导入的录音从项目自有缓存播放，**不依赖**有效的 OSS 签名 URL。
- [ ] Ogg Opus 使用正确 MIME、Range 语义和错误处理，拖动可用。
- [ ] 标题、转写、说话人和时长与官方客户端/云端原始数据一致。
- [ ] 导入幂等，`noteId` 和 `meetingId` 有永久映射。
- [ ] 常态服务运行不写 `kitdb.db`；有测试或日志证据。
- [ ] 已批准迁移的 8 条旧记录均“先替代后软删除”，并且已创建备份和映射台账。
- [ ] 已有 VIAIM 本地会议和现有 FilePort 推送路径通过回归测试。
- [ ] 日志、API 和界面不泄漏 `userToken`、refreshToken、完整 OSS 签名 URL 或个人标识。

---

## 8. 实施注意事项与禁止项

1. **不要**修改 `/Applications/读写笔记.app`、官方缓存、官方 app.asar 或官方客户端设置；它们只是行为证据。
2. **不要**把 `userToken`、refreshToken、完整预签名 URL、手机号、SN 写到源码、测试 fixture、截图或日志里。
3. **不要**在 `getNoteDetail` 失败时静默退化为“导入成功的占位会议”；前端应清楚说明失败并提供重试。
4. **不要**以临时 URL 是否存在判断音频是否缓存；唯一可信状态是项目数据库的 `download_state` 和本地文件校验。
5. **不要**删除或修改 `kitdb.db` 的记录，除第 5 阶段中用户已批准、已备份、已验证替代内容的 8 条迁移候选。
6. **不要**调用现有 `dbService.deleteMeeting()` 完成旧记录迁移，因为它会级联删除关联数据。
7. **不要**用音频扩展名猜 MIME；按 `.opus → audio/ogg; codecs=opus`、`.wav → audio/wav`、`.mp3 → audio/mpeg` 显式映射。
8. 所有新 UI 与错误信息保持中文，遵循项目现有暗色 VIAIM 视觉系统。

---

## 9. 交接材料与定位入口

| 材料 | 位置 | 用途 |
|---|---|---|
| 原始诊断报告 | `outputs/办公本云笔记集成诊断与完善方案.md` | 完整取证、现状问题和初步方案。 |
| 本实施交接计划 | `design-plans/03-office-notebook-cloud-integration-handoff-plan.md` | **后续 agent 的唯一实施基线**。 |
| 只读云端探针 | `.work/diag/probe_audio.mjs` | 验证录音地址、文件头和转写格式；只读。 |
| 探针日志 | `.work/diag/probe_audio.log` | 本轮实测结果。 |
| 官方静态解包（临时） | `/tmp/doxent_rea/app` | 逆向证据；不属于项目交付物，可在需要时重新解包。 |

---

## 10. 后续 agent 的第一轮操作清单

1. 阅读本文件、原始诊断报告和项目根目录的任何 `AGENTS.md`。
2. 在动代码前，检查当前 `kitdb.db` 的候选旧记录数、备份空间和项目数据目录权限；不打印敏感字段。
3. 先完成阶段 0 的项目自有库和只读防护，再做阶段 1 的音频下载闭环。
4. 用样本 noteId 或用户当前选中的录音笔记执行真实但只读下载验证；确认缓存可播后才改导入 UI。
5. 在阶段 5 前确保所有旧记录替代映射由用户在迁移 UI 中明确选定；严禁猜测映射或批量软删除。

### 2026-10-15 22:00 修复：推送到办公本 + 讯飞登录会话

协议依据见 `.work/diag/push-token-findings.md`（来自官方读写笔记客户端逆向和实测）。

| 问题 | 根因 | 修复（`server/iflytek_client.js`） |
|---|---|---|
| 推送报 OSS 500 | PUT 时发送了 `Content-Type: application/octet-stream`，OSS 网关返回 500；官方用空 Content-Type | PUT 改为 `Content-Type: ''` |
| 推送参数错误 | objectName 用了中文显示名；`saveFilePort` 参数与官方不一致 | objectName 改为 `MD5大写+随机ID.ext`；`saveFilePort` 改为 `{fileId:'',userId,sn:'',name,size,source:2,serviceIdentifier:'oss',params:JSON}` |
| 显示“在线”却访问不了云端 | “在线”只检查本地有无 token；设备接口失败时还会伪造一台在线设备；只在 401 时续期，而服务端返回 406/407；续期后没有保存轮换的 refreshToken | 406/407/409/410 先续期一次（单飞），并持久化新的 userToken+refreshToken；新增 `validateSession()` 和 `GET /api/notebook/session`；状态接口返回 `sessionValid/sessionReason`；去掉伪造设备；侧栏新增“需重新登录”红色状态 |

不变量：
1. 续期后必须立即保存新的 `refreshToken`（服务端会轮换，旧的会失效）。
2. 判断是否“在线”只能看 `sessionValid`，不能看 `authenticated`。
3. OSS PUT 不得带 Content-Type。

验证：推送“2026-01-27 14:32:07”后，云端读写驿站列表出现该文件（5578 B），回下载 HTTP 200；用假 token 测试时显示 `sessionValid:false`，设备数为 0。

## 2026-10-15 推送策略改造：读写驿站推纪要全文 + 办公本推录音笔记

**问题**：电脑录音的会议只往读写驿站推了一个 `.md`，办公本打不开。

**新策略**（`POST /api/notebook/push-summary`，body `{meetingId, targets?}`，两个目标独立返回 `results.fileport / results.record`）：
1. 读写驿站 ← 会议纪要全文 **DOCX**（`server/docx_writer.js` 零依赖生成，`server/minutes_document.js` 组织内容：摘要、详细纪要、议题、待办、完整转写）。
2. 办公本笔记 ← **录音笔记**（`server/notebook_push_service.js`）：录音转 Ogg Opus 上传到 `shorthand`；文字附件（`attachment`）先写纪要全文、再写带时间戳逐句转写；`/record/uploadDxkRecordFile` 创建/更新（映射表在 `notebook.db`，重复推送是更新不是新建）；放到“录音笔记”目录，来源为办公本的会议跳过。

**鉴权约束（不可回退）**：录音笔记上传接口只接受与签名同作用域的 userToken。
- dxk-book-web 签名 → 408；dxk-pc/dxk-cli 签名 + web userToken → 406。
- 使用官方 CLI 身份 `dxk-cli` 单独登录，会话存于 `~/.iflytek_notebook_token.json` 的 `recordScope`（独立 refresh 链，轮换后立即落盘）。与“读写笔记”官方桌面端（dxk-pc）隔离，不会挤掉官方客户端。
- 不得借用 `~/Library/Application Support/doxent/offline_info`：官方只在内存续期，文件是过期会话。
- 新登录会自动建立 recordScope；已登录用户在推送面板输入一次密码（`POST /api/notebook/record-auth`），密码不落盘。

**待验证**：录音笔记推送需用户完成一次授权后，用 `.work/diag/push_record_probe.mjs` 回读详情并核对办公本端显示。
