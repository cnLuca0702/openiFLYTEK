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

## 自动会议记忆（2026-10-15）

- `server/memory_store.js`：记忆表使用项目自有 `notebook.db` 的 `memory_*` 命名空间；中文分词/双字索引、完整转写分段、事实证据、内容版本及持久任务。官方库继续只读。
- `server/memory_service.js`：启动及每分钟扫描可读取会议；录音保存、转写完成、办公本导入时即时索引。每分钟最多提取一个批次（最多六个片段），复用已配置模型；未配置模型时只建原文索引。云端模型会收到待提取的文本，可能产生用量。
- 问答默认自动查找历史；`@` 保持范围限定；引用绑定来源版本、句子和时间，打开前重新校验。原文补查不依赖事实提取是否成功。
- 重新转写后旧版本退出当前检索；来源删除后记忆不可再召回，历史片段仅保留审计。不依据访问次数删除事实，不自动合并同名人物或项目，不把模型回答再次当成事实入库。
- 纪要侧显示独立的历史线索，不混入本次纪要、待办或办公本推送内容。
- 检索使用中文关键词和提取事实，不含向量模型或完整全库汇总；第二阶段的跨会议关联见下文，检索结果需标明片段范围。
- 测试：`npm test`（临时 SQLite、模拟模型、独立 HOME 的 HTTP 测试）；HTTP 测试使用 `VIAIM_MEMORY_SKIP_OFFICIAL=1` 避免读取本机官方数据。`npm run build` 检查前端。
- 已通过隔离自动化测试和构建；真实 macOS Electron 播放定位、真实模型提取质量仍需实机验证。

## 自动会议记忆第二阶段（已实现，2026-10-15）

- `server/memory_graph.js` 从有效来源的结构化事实重建项目关联、属性状态及替代链。按明确单位/客户范围 + 项目名称、项目编号或明示简称关联；身份不足保持单场来源，同名不同单位/冲突编号不得合并。不同交付阶段使用独立属性对象。
- 提取协议升级为 v2。实体、属性对象、值和替代证据必须绑定逐字引文；模型不能直接指定已有实体/事实 ID。`memory_facts.structure_json` 为兼容性增量字段，旧任务自动重新排队一次，不要求手动建库或迁移。
- 比较会议发生时间、生效时间及首次记录时间。明确变更可建立替代边；未重复旧值时只允许替代唯一无歧义的先前状态。普通较新说法不覆盖旧事实；建议、否定、未来生效及时间不明分别标识。常见相对日期按会议的北京时间解析，不支持的日期保留不确定性。
- 来源删除或版本变化后，状态从剩余有效证据重算；暂不可读、提取尚未完成或证据超出容量时提示不完整，不把遗漏证据当成已撤销。历史原文和失效事实保留审计，官方库仍只读。
- 问答自动扩展关联项目的完整证据链（有容量上限），提供 `projects` / `memoryWarnings`；`MemoryState.tsx` 展示当前断言、冲突、替代历史及可定位来源。显式 @ 范围严格限制项目状态，不能引入范围外的新决定。
- 第三阶段已获用户批准并实现代码，详见下节；实机验收状态与依赖限制不得省略。
- 第二阶段通过隔离规则、存储升级、后台提取、问答集成测试及前端构建；真实模型的语义提取质量与 macOS 界面仍需实机验收，不承诺模型不会误读转写。

## 自动记忆第三阶段（代码已实现，2026-10-15）

- 用户已批准第三阶段，并增加上传文档知识来源。参考已取得的 `ppt-speech.zip` 知识库模式：本地 `.work/references/ppt-speech/`（不提交），原包 SHA256 `81ad8e6da2f1705ac1b74bbe9cf9a1dcc13372f039c20baa32a99acd5ef7c83d`。只采用资料解读流程，不执行讲稿生成或外部知识库发布。
- `document_reader.js` / `document_worker.js`：本地独立线程解析；PDF 全页渲染，PPT/PPTX/DOC 依赖 LibreOffice 转 PDF，PPTX 备注单列为阐释；DOCX/TXT/MD 按段落组，XLSX/CSV 按工作表/行与单元格定位；PNG/JPEG/WebP 走视觉解读。单文件 40MB、200 页/段落组、200 万字，Office 解压体积有限制。超限、加密、损坏或缺少转换器不能冒充成功。
- `document_service.js`：使用同一项目 `notebook.db` 的 `documents` 表；原件、页图、可恢复知识 Markdown 位于项目 `cache/documents/<sha256>/`。内容散列去重；同名不同内容并存，明确“更新版本”时，只有新版本处理成功才移出旧版。移出为软删除，保留本地审计文件。
- 后台每 3 秒最多推进一个处理步骤，逐页结果、知识批次和退避时间持久化。图片模型先通过图片中随机数字读取检查，再逐页解读；所有页面完成后才开始知识整理，全部整理完成才进入记忆。失败保留进度自动重试，无文本降级入库。
- 知识问答/案例/方法/术语用于检索扩展；事实提取仍只读来源文字与明确标注的页面视觉解读，不把知识归纳循环写成已证实事实。模型视觉解读仍可能误读，引用必须可打开原页核对。文档来源保留页/段落/表格位置，未知材料日期不使用上传时间替代；明确发布日期才参与时间比较。
- `memory_followups.js`：v3 提取任务自动回填。按原文明示的单位、项目、事项关联承诺和问题，保留责任人/期限/完成/答复/取消的引用链。无后续提及不等于完成；时间缺失、相互矛盾、身份不足不能确定闭环。删除或版本变化后从有效来源重算。
- 顶部“记忆与资料”支持批量上传/拖放、处理进度、源文件/页面/知识查看和自动跟进；纪要中独立展示相关变化与跟进，不改写本次待办、纪要正文或办公本推送。默认问答跨会议与文档，显式 @ 会议范围仍严格隔离。
- 新接口 `/api/documents`、`/api/documents/:id`、`/api/documents/:id/file/:kind`、`/api/documents/:id/retry`、`/api/memory/insights`；文档 API 不向前端暴露本地路径。原件缺失/变动时引用失效。文档模块初始化失败不会阻止原录音后端启动。
- 验证：`npm test` 全部 45 项通过，`npm run build` 通过；覆盖隔离 SQLite/模拟模型/真实本地 PDF 渲染、工作线程解析、HTTP 上传→整理→跨来源问答→引用→删除，以及原一二阶段回归。macOS Electron 实机交互、LibreOffice 的真实 PPT 转换和真实视觉模型的语义质量仍待实机验收；当前 Linux 环境没有 LibreOffice。未部署到用户 Mac。

## macOS DMG 打包（2026-10-15）

- `npm run app:dmg`：构建前端与 `.app` → 使用包内 Electron 的独立 HOME 冒烟验证 → 生成并校验 DMG。须在 macOS 安装对应架构的 Electron 运行文件。
- `electron/package-mac.cjs` 将生产依赖实际安装到应用包中，不再软链接开发目录；Express/CORS/WS 归入运行依赖。对应用做 ad-hoc 签名并验证，未做 Developer ID 签名或 Apple 公证。
- `electron/smoke-package.cjs` 验证包内 SQLite、原生 canvas、后端启动、记忆接口与文档上传/原文下载，测试使用临时 HOME 和空闲端口，不操作用户现有资料。
- Apple Silicon Mac 已通过全部 45 项测试、前端构建、包内运行验证和 `hdiutil verify`。DMG 产物不提交 Git，位于构建机 Downloads 和本地忽略目录 `outputs/`。
