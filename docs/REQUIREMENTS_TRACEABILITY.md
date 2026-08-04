# R2Uploader 2.0：58 项需求实现与验收追踪

更新时间：2026-08-04

本文件把 [`R2UPLOADER_REQUIREMENTS_DETAIL.md`](../R2UPLOADER_REQUIREMENTS_DETAIL.md) 中确认的 58 项非团队需求逐条对应到实际代码。它回答两个不同的问题：

- **实现是否存在**：入口、状态、服务、约束和失败路径是否已经落到代码；
- **是否已经完成真实环境验收**：是否在具有对应权限的 Cloudflare/OpenAI 账号、真实网络、签名证书和目标操作系统上跑过端到端场景。

状态说明：

- **代码完成**：产品入口和后端闭环已经实现，并纳入本地类型检查、测试或构建验证；
- **需云端验收**：代码完成，但正式发布前仍必须使用受控测试账号验证远端权限、网络中断、Cloudflare 配置或 OpenAI 计费路径；
- **需发布验收**：代码和 CI 配置完成，但只有带真实证书的 tag 构建才能证明签名、notarization、安装与跨版本升级。

团队工作区、成员管理、RBAC 和团队审计不在这 58 项内，也没有被偷偷加入产品模型。

## P0：信任与可靠性地基

| ID | 实现结果 | 主要代码证据 | 发布前剩余验收 |
|---|---|---|---|
| P0-01 | 代码完成 | `r2-object-service.ts` 的认证浏览；`home.tsx` 的 Private 默认创建、访问状态和独立域名确认；`register.ts` 要求 `confirmation: true` 才能改变 managed domain | 用私有、r2.dev、自定义域名三类 bucket 记录打开前后配置，确认浏览无副作用 |
| P0-02 | 代码完成 | `r2-object-service.ts` 统一 LIST/HEAD/GET/PUT/DELETE/COPY；`preview-service.ts` 使用短时 `r2preview:` grant 和认证流 | 关闭所有公开域名后，真实验证浏览、预览、下载、上传、重命名和删除 |
| P0-03 | 代码完成 | `config-vault.ts` 使用 Electron `safeStorage`；preload 只返回摘要；旧配置迁移后移除明文 token；`error-log.ts` 和 `diagnostics.ts` 脱敏 | macOS Keychain、Windows DPAPI 各扫描一次用户目录、renderer state、IPC 和诊断包 |
| P0-04 | 代码完成 | `diagnostics.ts` 分步测试 vault、认证、列 bucket、读、可选写和清理、S3 能力；`connection-editor.tsx` 展示逐项结果 | 用错误 Account ID、过期/只读/单 bucket token、断网和 S3 endpoint 各跑一次 |
| P0-05 | 代码完成 | `app-error.ts` 的 typed error；`register.ts` 统一包装 IPC；`error-panel.tsx` 区分错误与空状态并提供复制/重试建议 | 对 Cloudflare 401/403/404/409/429/5xx 和超时做故障注入 |
| P0-06 | 代码完成 | `transfer-manager.ts` 通过认证 HEAD 解析冲突和已有对象元数据；`upload-planner.ts` 复用目标计划；批量入口提供 skip/overwrite/rename/apply-all | 在私有 bucket、自定义缓存域名、无公开域名三种状态下核对结果 |
| P0-07 | 代码完成 | `object-operations.ts` 按 copy → HEAD verify → source delete 执行并持久化 journal；`history-recovery.ts` 处理恢复；部分成功保留两份对象 | 注入复制、校验、源删除和进程退出故障，核对 journal 与远端状态 |
| P0-08 | 代码完成 | `transfer-manager.ts` 持久队列、进度/速度/ETA、1–8 并发、暂停/取消/重试；`r2-object-service.ts` multipart、abort、远端 size 验证；明确派生文件安全清理 | 小文件、>300 MB、断网、批量冲突、暂停后立即重试、取消和应用重启的真实传输 |
| P0-09 | 代码完成 | `trashObject` / `trashFolder` 默认移动至 `.r2uploader-trash/`；对象面板分离恢复与永久删除；bucket 删除先检查为空并要求名称确认 | 对批量部分失败、Trash 恢复、永久删除、非空 bucket 删除逐项核对 |
| P0-10 | 代码完成 | `BucketItem.access` / `ShareLink.kind` 类型；`home.tsx`、对象详情和分享区分别呈现 private/public-managed/public-custom/temporary 及到期时间 | 对四种访问方式从另一未登录设备验证可达性和失效时间 |
| P0-11 | 代码完成 | `shared/object-listing.ts` 处理 folder-only；响应式网格与 titlebar drag/no-drag 样式；`issues-2-3-5-regression.test.ts` 回归 #2/#3/#5 | macOS 与 Windows 实机缩放、拖动、folder-only bucket 复核 |
| P0-12 | 代码完成，需发布验收 | 版本已升至 2.0.0；`electron-builder.config.cjs` 统一 artifact 命名、macOS 双架构/Windows x64、签名硬门槛、notarization、协议；`release.yml` 校验 tag=version 并从同一 commit 发布；`background.ts` 自动更新与手动回退 | 配置真实 secrets 后跑 tag；验证三类安装包启动、签名/notarization、1.x → 2.0 自动升级 |
| P0-13 | 代码完成 | 移除 LemonSqueezy/激活 gate；README 明确 GPL、自构建免费核心和未来可能收费边界；侧边栏显示 Free core | 发布页与 README 同步复核，不得保留旧购买/强制激活文案 |
| P0-14 | 代码完成 | `preload.ts` 显式 capability API；`register.ts` 每个命令 Zod 校验；sandbox、CSP、导航/新窗口/webview/权限拦截；外链 HTTPS host allowlist | 打包后做一次 preload/导航/CSP/恶意 payload 渗透回归 |
| P0-15 | 代码完成 | `diagnostics.ts` 生成有界摘要；`error-log.ts` 仅保存脱敏错误；`diagnostics-dialog.tsx` 导出前可预览 | 填入 canary token、域名和长 key 后扫描导出 JSON，确认无完整敏感值 |
| P0-16 | 代码完成 | `object-key.ts` 规范化；`cloudflare-client.ts` 按 segment 编码对象 key 和 API path；`object-key.test.ts` 覆盖空格、中文、`+/#/%/?` | 在真实 R2 上上传并读写特殊字符对象 |
| P0-17 | 代码完成 | 删除不可达依赖；`DEPENDENCY_SECURITY.md` 记录决策；`audit:prod`、CI advisory gate、lockfile override | 每次依赖升级运行 UI build、测试和 `npm audit --omit=dev` |

## P1：日常素材管理体验

| ID | 实现结果 | 主要代码证据 | 发布前剩余验收 |
|---|---|---|---|
| P1-01 | 代码完成 | `transfer-manager.ts` 持久化 upload/download/copy/move 队列，远端任务包含 source/destination 并按目标串行化；文件夹操作展开为后台对象任务；`transfers.tsx` 实时状态；`transfer-center.tsx` 汇总与单项进度、重试/清理和系统打开 | 多页面切换、窗口隐藏、应用重启、远端长任务和部分失败后核对队列状态 |
| P1-02 | 代码完成 | bucket 页面全页 drag enter/leave/drop；目标前缀提示；文件夹卡片支持定向 drop | macOS Finder、Windows Explorer 各拖入单/多文件并测试取消 |
| P1-03 | 代码完成 | `local-file-registry.ts` 递归遍历并保留 relativePath；明确跳过 `.DS_Store`/symlink、保留其他 dotfile、说明空目录限制；drop 保留顶层目录而 chooser 上传目录内容；计划页展示策略 | 含空目录、深层目录、同名文件、dotfile、symlink 和大量文件的 macOS/Windows 目录测试 |
| P1-04 | 代码完成 | bucket 页 checkbox、Shift 范围、全选、框选；批量 Trash、分享、移动/复制 | 1000+ 对象下选区、分页/搜索切换和部分失败状态复核 |
| P1-05 | 代码完成 | `folder-operations.ts` 隐藏 marker、整前缀规划 copy/move/trash；大目录展开进入全局传输队列；单文件夹 destination name 完成 rename；UI 有新建、定向 drop、移动/复制和 Trash | 空前缀、跨 bucket、目标位于源内、数千对象和部分失败场景 |
| P1-06 | 代码完成 | `organize-dialog.tsx` 预览目标 bucket/prefix/name；ask/skip/overwrite/rename 四种冲突策略；`transfer-manager.ts` 在目标校验后才删来源 | 跨 bucket 大对象、四种冲突策略、复制成功但删除失败实测 |
| P1-07 | 代码完成 | bucket 页按名称、大小、修改时间排序；类型和时间筛选；`object-listing.ts` 稳定计算 | 多页结果和时区边界下核对排序/筛选语义 |
| P1-08 | 代码完成 | 文件夹内 prefix 搜索和整 bucket contains 搜索分开；`object-search.ts` 受控翻页、扫描数和截断提示；搜索历史可关闭 | 超大 bucket、2,048 字符上限、截断结果和断网错误测试 |
| P1-09 | 代码完成 | bucket 页 grid/list SegmentedControl；偏好持久化；两种视图操作一致 | 窄窗、长 key、图片/非图片混排和键盘操作复核 |
| P1-10 | 代码完成 | 统一 ObjectPanel；`preview-service.ts` 支持 range；图片/视频/音频/PDF/文本与不可预览 fallback；已完成下载可由 Transfer Center 系统打开或定位 | 各格式、超大媒体、range seeking、无 Content-Type 对象和不同默认应用测试 |
| P1-11 | 代码完成 | `headObject` 返回 HTTP/custom metadata；对象面板展示并可编辑；Cache-Control 快捷预设；保存前明确 REPLACE 语义与遗漏字段影响并写入历史 | S3 与 R2 metadata 替换语义、缓存即时影响、Unicode metadata 复核 |
| P1-12 | 代码完成 | Next 动态路由 + 编码参数；breadcrumb；浏览器后退/前进；收藏与最近位置 | 特殊字符 bucket/key 和深层 breadcrumb 实测 |
| P1-13 | 代码完成 | `temporaryShare` 生成最长 7 天 presigned URL；public URL 只从 enabled domain 生成；UI 标明永久/到期 | 不同 TTL 和域名切换后的链接实测 |
| P1-14 | 代码完成 | `share.ts` plain/Markdown/JSON/custom formatter；设置持久化模板；单个与批量分享复用 | 模板变量、转义、超长清单和剪贴板测试 |
| P1-15 | 代码完成 | bucket access 对话框列出全部域名并可选默认项；应用内 attach-disabled、刷新、启用/停用、移除 custom domain；ownership/SSL 未 active 时后端和 UI 都阻止启用与生成链接；managed domain 独立确认 | 使用真实 Zone ID 验证绑定、证书初始化、停用/重启和多域名默认项 |
| P1-16 | 代码完成 | `config-vault.ts` 多 profile；`app-shell.tsx` 切换前提示未完成任务；删除含未完成任务的 Profile 会被后端阻止；history 按当前 Profile 过滤；`connection-editor.tsx` 支持 R2/S3 | 多账号同名 bucket、后台任务切换、删当前 profile、locked vault 场景 |
| P1-17 | 代码完成 | `i18n.ts` 中英文词典和动态文案；设置切换；native updater/tray/dialog/companion 跟随 locale | 中英文逐屏走查，保留 provider code/request ID 等必要技术原文 |
| P1-18 | 代码完成 | `modal.tsx` focus trap/Escape/focus restore；全局 focus-visible、reduce-motion；bucket 页键盘/范围/框选；快捷键说明 | VoiceOver 与 Windows Narrator 实机走查，验证对比度和读屏顺序 |
| P1-19 | 代码完成 | 页面显示同步时间和 remote/cache 来源；手动刷新、interval fallback、`event-refresh.ts` 推送变化事件 | 外部 CLI 上传/删除后分别验证 Queue 刷新和轮询 fallback |
| P1-20 | 代码完成 | `object-cache.ts` 大小上限、LRU、ETag 校验、清空和 prefix offline pin；preview 响应标明命中/离线 stale | 断网、ETag 变化、磁盘满、超过 cache 上限场景 |

## P2：差异化能力

| ID | 实现结果 | 主要代码证据 | 发布前剩余验收 |
|---|---|---|---|
| P2-01 | 代码完成 | `upload-planner.ts` 用 Sharp 生成 WebP/AVIF/JPEG、尺寸/质量/保留原图预设；上传前显示输出大小/key；处理异常会清理派生临时目录、逐项警告并退回原文件 | HEIC/TIFF/GIF/透明 PNG/EXIF 方向、损坏图片与极大图片样本测试 |
| P2-02 | 代码完成 | 命名模板支持 name/ext/date/time/index/hash8/random/uuid/width/height/project；random/uuid 为每项生成 12 字符值；空输出回退、安全清理 slash/非法字符、计划页逐项预览 | 空 token、重名、无扩展名、批量同秒和随机碰撞测试 |
| P2-03 | 代码完成 | `asset-index.ts` SHA-256；计划与 transfer 都检查重复；ask/skip/upload 策略 | 旧对象重建索引、跨 bucket 相同内容和哈希计算中断测试 |
| P2-04 | 代码完成 | 本地 asset index 保存 key/type/size/hash/尺寸/时长/tags/description；bucket tools 可 rebuild/edit/search | 大 bucket 重建、对象删除/改名后的索引一致性复核 |
| P2-05 | 代码完成 | `analytics.ts` 查询 Cloudflare GraphQL storage/operations；bucket tools 展示样本、总量和时间范围 | 具有 Analytics Read 权限的账号核对 Dashboard 同期数据 |
| P2-06 | 代码完成 | 估算器用小数用量计算 storage/Class A/Class B，分别显示 free-tier 与 USD；R2 internet egress 显式为 $0，IA retrieval 和未知操作明确排除；显示存储增长异常、定价日期和官方来源 | 按当前 Cloudflare 账单、存储类别和定价页定期复核常量与排除项 |
| P2-07 | 代码完成 | `sync-manager.ts` 递归扫描、exclude、preview、变更 manifest、每分钟 upload-only、暂停和冲突策略 | 大目录、mtime 变化、应用重启、失败重试、文件在排队后变化的测试 |
| P2-08 | 代码完成 | `backup-manager.ts` 分页下载、size + SHA-256、版本目录、manifest、保留数；完整/单 key/prefix 恢复前再次验 hash；完整快照可映射到新目标 prefix | 部分下载不得替代/修剪上次完整快照；磁盘满、篡改 manifest、新 prefix 映射和恢复冲突实测 |
| P2-09 | 代码完成 | `bucket-admin.ts` 获取/保存 lifecycle；bucket tools 提供场景字段、影响抽样、高风险确认、原始 JSON 校验/应用/复制/导出；变更写入本地历史 | 用带生命周期权限的测试 bucket 创建、回读、修改、删除和 JSON round-trip |
| P2-10 | 代码完成 | 对象 Cache-Control 预设；`bucket-admin.ts` CORS 获取/保存；CORS 场景预设、影响说明、JSON 校验/导出和单级 previous-config 回滚；变更写入历史 | 浏览器跨域预检、对象缓存头、应用重启前后的回滚边界实测 |
| P2-11 | 代码完成 | `checkDomainHealth` 检查 DNS/TLS/HTTP/timing；域名工具展示逐项状态且不修改配置 | 正常、DNS 失败、证书过期、HTTP 4xx/5xx 域名样本 |
| P2-12 | 代码完成 | `event-refresh.ts` 创建 notification rule、拉 Queue、ack、按 bucket 广播；失败显示 fallback-polling；设置保留 interval | 专用 Queue 权限、事件延迟、重复消息、暂停/恢复和消费冲突测试 |
| P2-13 | 代码完成 | `quick-upload.ts` 剪贴板/文件入口、统一上传计划、自动改名/查重、完成后生成链接；tray/全局快捷键；通知明确 Profile 名、bucket、prefix | Windows/macOS 剪贴板格式、锁屏、未配置、链接失败但上传成功场景 |
| P2-14 | 代码完成 | `batch-share-dialog.tsx` 受控并发生成链接、逐项失败、保持成功项顺序，支持 txt/Markdown/HTML/JSON/CSV 复制与文件导出 | 100+ 对象、部分 bucket 无公开域名、临时链接过期、各格式 round-trip 测试 |
| P2-15 | 代码完成 | `operation-history.ts` 最多 90 天/2,000 条；`history-dialog.tsx` 按当前 Profile 搜索、状态、JSON 导出和清空；明确导出含完整 bucket/key；`history-recovery.ts` 只执行定义过的安全恢复 | move/trash/partial 的可逆性、目标冲突、过期清理和大历史性能测试 |

## P3：个人效率与生态扩展

| ID | 实现结果 | 主要代码证据 | 发布前剩余验收 |
|---|---|---|---|
| P3-01 | 代码完成（手动同步模型） | `config-vault.ts` AES-256-GCM + scrypt 加密包，可选 secrets，显式 merge/replace；包含 Profile、偏好、收藏、命名预设、sync/backup/automation 任务；无凭据 merge 保留本机 Secret；导入任务默认暂停并可重新绑定本地目录；恢复口令轮换保护后续密文版本 | 这是用户自管同步文件而非托管账号服务；需跨 macOS/Windows、同步盘冲突、错误口令、篡改、重复 ID、口令轮换和已导入凭据撤销测试 |
| P3-02 | 代码完成 | `automation.ts` 按 profile/bucket/prefix 匹配，copy/link/notification；event/action checkpoint 保证幂等；UI 暂停全部规则并展示最近 500 次运行的动作、失败和对象上下文 | 多规则、部分失败、重启后重放、public domain 缺失和 checkpoint 恢复测试 |
| P3-03 | 代码完成 | `cli/r2uploader-cli.mjs`、`r2uploader://upload?v=1&client=…`、`protocol-handler.ts`；每次请求显示版本、caller、目标与路径并要求批准；CLI 不持有凭据且没有持久授权，因此无需维护可遗忘的授权名单 | 安装包协议关联、路径包含空格/Unicode、多实例、恶意 URL、缺失/未知版本测试 |
| P3-04 | 代码完成 | profile provider/endpoint/region/path-style；`r2-object-service.ts` S3 List/Head/Get/Put/Copy/Delete/Presign；UI 隐藏 Cloudflare-only tools | MinIO、AWS S3 或另一兼容厂商各至少做一轮 CRUD/multipart/presign；记录兼容差异 |
| P3-05 | 代码完成（临时会话模型） | `companion-server.ts` 单次临时自签 HTTPS、256-bit token → HttpOnly/Secure/SameSite cookie、read-only API、prefix 边界、rate limit、CSP、到期关闭；UI 显示指纹并可 Stop now 即时撤销会话 | 该模型不创建长期设备授权；需用 iOS/Android、不同局域网、防火墙、证书指纹、停止和自然过期测试 |
| P3-06 | 代码完成 | `openai-ai.ts` 显式确认、受限格式/25 MB、缩小 JPEG、Responses `store:false`、strict JSON schema、Embeddings、local cosine；删 key 清 AI 数据 | 使用独立低额度 OpenAI project 验证模型权限、费用、429/超时、图片格式和删除数据 |

## 自动化验证覆盖

当前本地自动化覆盖以下层级：

- 主进程和 renderer 独立 TypeScript 检查；
- typed error 分类和脱敏；
- 特殊对象 key 的规范化/编码；
- folder-only、响应式网格和窗口拖动回归；
- 全 bucket contains 搜索的翻页、截断和错误传播；
- 58 个需求 ID 的数量、唯一性、P0–P3 分布和团队范围排除；
- traceability 文件包含每个批准 ID；
- release config 包含协议、CLI、双 macOS 架构、Windows x64 和 release signing gate；
- production dependency audit；
- Next/Electron production build；
- Electron Builder 本机目录包结构检查。

## 不能用本地绿色测试替代的验收

以下结论必须保持诚实：代码存在和本地 build 通过，不等于真实云端、平台签名或第三方服务已经被证明可用。

正式发布前至少需要准备：

1. 一个私有 Cloudflare 测试账号，包含只读、读写、单 bucket 和 analytics/event/policy 等分级 token；
2. R2 S3 credentials 和一个 >300 MB 测试对象；
3. 一个专用 Cloudflare Queue，不能复用生产消费者的 Queue；
4. macOS Developer ID/notarization 与 Windows code-signing secrets；
5. 一个有硬性费用上限的 OpenAI 测试 project；
6. macOS Intel、macOS Apple Silicon、Windows，以及至少一台 iOS/Android 设备。

只有完成表格中的“发布前剩余验收”，才能把相应条目从“代码完成”升级为“发布验收完成”。
