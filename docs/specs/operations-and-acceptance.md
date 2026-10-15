# 运行默认值、恢复与验收

## 1. 状态与适用范围

本文规定目标实现，不代表当前已支持。当前仓库已有 FastAPI 健康检查、配置/异常/日志、数据库会话、身份会话与项目成员闭环，登录页、项目列表和工作台，模型目录的登记、停用、恢复和每项业务的模型指定，以及一次显式文本补全。文本补全由独立进程领取 PostgreSQL 中的 queued 记录，在事务外通过 OpenAI 兼容适配器调用；HTTP 请求不等待供应商。密钥、接口地址、供应商别名、可登记模型和支持参数只在未提交的 `model-endpoints.yaml`。没有 Celery Worker、Outbox Dispatcher 或生产部署。图片生成由另一个独立进程领取 queued 记录，在事务外调用 OpenAI 兼容的 images 接口，并把图片字节写入私有对象存储。文生视频由单独进程领取 queued 记录，提交后按 next_poll_at 轮询，成片写入私有对象存储；提交结果不明时不得重发。登录后进入个人创作空间，不必先手动建项目。已有标准空间保持不变。对话持久化、知识库、记忆、跨空间资产汇总和通用资源库尚未实现。管理页不能发起供应商调用。

本轮代码已经实现身份与项目闭环。其余代码与目标规范不一致的部分列在第 6 节，不能把测试通过当作未列出的业务已经交付。

## 2. 集中配置默认值

以下为首期默认值，集中进入 Settings 或版本化模型/检索配置；超界启动时失败，不在业务文件散落常量。模型能力可以进一步收紧限制。

| 项目 | 默认值/上限 |
| --- | --- |
| 单文件 | 文档 20 MiB、参考图 10 MiB；首期不开放用户视频/音频上传 |
| 生成结果下载 | 单文件 1 GiB；按流读取并限制总字节 |
| 上传凭据 / 下载 URL | 10 分钟 / 5 分钟 |
| 单项目活动视频任务 | 3 个（queued/submitting/running/cancel_requested 都计入） |
| 单用户/项目对话并发 | 每会话 1 个，每项目最多 3 个 |
| 单用户请求 | 120 次/分钟；登录 5 次/分钟/IP+账号；生成提交 10 次/分钟 |
| 提示词 / 消息 | 10000 字符 / 20000 字符，并受 token 限制 |
| HTTP 连接 / 普通依赖请求 | 5 秒 / 30 秒；文本调用整体 180 秒；解析 120 秒 |
| 视频自动观察窗口 | 24 小时；超过进入人工核对，不能假报失败 |
| 瞬时调用重试 | 默认最多 3 次，仅用于可安全重试操作；submit 未决禁止重试 |
| 租约 / 心跳 / 恢复扫描 | 60 秒 / 15 秒 / 30 秒 |
| Outbox delivery 重试 | 8 次，退避 1–300 秒并抖动 |
| 已删除内容清理 | 标记后 7 天清理对象/正文；标记后立即禁止读取 |
| 成功事件/幂等墓碑/任务诊断 | 完成后 30 天；未完成事件不得按期限删除 |
| 备份 / 目标恢复 | 每日备份并启用 PG 连续日志归档；上线验收目标 RPO<=1小时、RTO<=4小时 |
| 应用日志文件 | 默认保留 7 天，由 `LOG_RETENTION_DAYS` 调整；本地目录为 `logs` |

活动并发上限在 PG 中通过项目锁/原子计数检查，不能只依赖可丢失 Redis。Redis 限流不可用时，登录和新模型提交返回 503；普通 PG 读取仍可用。此限制是资源保护，不是 Credits/Quota 账本。

文档/消息/记忆/已生成资产默认保留至用户删除。操作日志不记录正文，默认 30 天。备份默认保留 30 天，删除数据可能在备份窗口存在；恢复后必须重放删除清单，再开放用户访问。长期未决任务不自动清除。

## 3. 部署与启动

本地 docker-compose.yml 启动 PostgreSQL、Redis、Elasticsearch、MinIO、API、Worker 和前端开发服务器。PostgreSQL、Elasticsearch 和 MinIO 分别使用 `postgres_data`、`elasticsearch_data` 和 `minio_data` 命名卷保存开发数据，普通停止、启动或重建容器不会删除；`docker compose down -v` 会显式删除这些卷。API 与 Worker 的 JSON 日志同时写入宿主机 `logs/`，按 `LOG_RETENTION_DAYS` 保留，默认 7 天；修改天数后重新创建进程生效。开发 Compose 在启动 API 前执行 Alembic upgrade；镜像默认命令只启动进程，生产仍按发布顺序单独迁移。`make test` 执行已有测试，`make run` 仍可在宿主机启动 API。本地命名卷不等同于生产备份与恢复方案。

业务完成后提供独立 API、Worker、Dispatcher、恢复调度器命令，均使用相同代码版本。队列按 video/ingestion/indexing/chat 分离；批量重建限流，不能饿死对话。Redis 不配置 Celery result backend。

生产发布顺序：验证环境与备份 → 执行兼容迁移 → 部署 API/Worker → 健康检查 → 开启新功能。数据库采用 expand/contract，先加兼容字段、回填、切换代码，后续发布才删旧字段。回滚应用不随意 downgrade 删除业务数据。

健康端点 /healthz 仅表示进程存活；API /readyz 以 PG 与必需配置为准，ES 不可用不应摘除全部普通业务 API。Worker 就绪按其队列依赖检查，搜索功能单独返回降级状态。

生产要求：私网数据库/ES/Redis、认证和 TLS、持久卷/托管存储、非默认密钥、对象存储私有、HTTPS 反向代理、受限 CORS、上传大小限制。开发 Compose 的默认密码/开放端口/禁用 ES 安全不能用于生产。

## 4. 故障处置

| 故障 | 自动行为 | 人工恢复验收 |
| --- | --- | --- |
| PG 不可用 | 业务写入与授权读取失败，不转向 ES | 恢复 PG 后确认事务未半提交 |
| ES 不可用 | 业务写入成功、检索明确 503、积压 delivery | 恢复/重建并对账，确认旧版/删除不返回 |
| Redis 丢失 | SSE 重连用 PG 快照，PG 扫描重投 | 未完成 delivery 与任务可恢复，无重复 submit |
| Worker 崩溃 | 租约到期后接管 | 旧 token 结果拒绝；未决 submit 不重发 |
| 对象写成功、PG 失败 | 不显示成功资源，后台收敛 | 校验同一 object_key 可复用，孤儿超过 24 小时且无活跃租约才清理 |
| 供应商提交超时 | reconciliation_required，停止重复付费动作 | 查询远端证据并经 Service 记录，不直接 SQL 改状态 |
| alias 切换中崩溃 | 暂停后续切换，核对实际 alias | PG build 与 alias 幂等收敛后继续 |

运维命令必须有 dry-run、范围（项目/事件/任务）、操作者和结果审计；默认不得批量重提交供应商任务。PG 备份恢复后，从 PG+对象存储重建 ES、重投未完成事件；恢复期间不接受新的付费提交，先核对远端存量任务。

告警默认：最老待投事件>60 秒、索引延迟>5 分钟、failed delivery>0、未决提交>5 分钟、租约反复过期、对象结果保存失败。记录计数与延迟，不携带正文、密钥或 Cookie。

## 5. 交付验收矩阵

| 阶段 | 必须验证的行为 |
| --- | --- |
| 身份/项目 | 登录轮换、登出撤销、CSRF 拒绝、单 OWNER、成员越权与跨项目 ID 替换 |
| 数据/事务 | 并发同幂等键只建一任务；不同键可建多任务；嵌套 Service 失败一起回滚 |
| 任务/供应商 | 每条允许/禁止状态转移；submit 未决、取消失败、迟到结果、租约 fencing、重试不重复收费 |
| Outbox/ES | PG 提交后队列失败、ES 成功后消费标记失败、乱序删除、broker 全丢、增量重建和切换崩溃 |
| 对话/RAG | SSE 重放/过期、partial 与完整区分、跨项目召回拒绝、旧版/删除引用拒绝、无证据与故障区分 |
| 记忆 | 显式确认、修订冲突、来源删除、记忆删除立即停止召回 |
| 前端 | 项目切换迟到响应、401 清缓存、409 保草稿、状态真实、窄屏及键盘操作 |
| 运维 | 实际恢复备份并测 RPO/RTO；PG+对象存储可完整重建索引 |

CI 分阶段启用 Ruff/pytest、后端类型检查（固定使用 mypy，接入时锁定）、前端 ESLint/Prettier/tsc/build/Vitest、OpenAPI 客户端差异检查。真实 PG/ES 的集成测试只用于相关能力；纯领域测试不强行依赖外部服务。Playwright 验证真实 API 与受控 Provider，不能全靠前端 mock。

边界测试使用 AST/实际 import 路径验证：domain 禁止框架依赖；router 禁止 SQL/SDK；仅 infrastructure/ai/adapters 可导入 LangChain/供应商 SDK。不要禁止整个 infrastructure 使用 SDK，否则会拒绝合法适配器。CI 未建或依赖服务未运行必须明确写“未验证”。

## 6. 当前代码与目标差距

- `0001_baseline` 仍是空迁移。`0002_auth_and_projects` 创建 users、sessions、projects、project_members 和 outbox_events。`0003_model_configs` 增加 users.platform_admin、model_configs 和 model_config_audits。`0004_text_completions` 增加一次文本补全记录。`0005_image_generations` 增加生成任务和资产，`0006_model_assignments` 增加业务指定，`0007_video_generations` 为生成任务增加 image/video 种类并允许视频的 submitting 状态。`0008_personal_spaces` 为 projects 增加 kind，并用部分唯一索引保证每个创建者至多一个未删除的个人空间；不回填、不搬迁已有项目。event_deliveries 尚未创建。Celery 仍未接入。
- 文生视频适配器会提交并轮询 DashScope 异步任务，成片写入对象存储。供应商取消接口未接入，因此 submitting 和 running 的取消返回 409，不进入 cancel_requested。
- ParsedDocument 目前只有 text，必须扩展 blocks/locator 才能提供可核验引用。
- 当前边界测试扫描整个非 DB infrastructure，会误禁合法 LangChain 适配器；实施 AI 接入时修正测试范围。
- 身份和项目的外层 Service 已拥有并提交同一个 UoW，项目模块通过 auth Service 读取用户。Worker 工厂的完整生命周期仍未落实。
- 校验错误不再回显原始输入。登录限流尚未接入；Redis 不可用时登录应返回 503，这项仍待实现。
- 登录页、项目列表、工作台和模型目录管理页可由前端开发服务器使用，并代理 `/api`。模型目录登记、停用和恢复配置，并为每项业务指定一个模型。文本补全和图片生成由独立进程领取 queued 记录后调用 OpenAI 兼容接口；图片字节进入私有对象存储。文生视频由 video-worker 领取，调用已指定的 text_to_video 适配器后把视频字节写入对象存储。Celery、Outbox Dispatcher、RAG、记忆、业务 CI 和生产部署均待实施。项目删除已写入 `project.deleted.v1`，尚无消费者。

未列入上面已实现范围的项目仍待后续阶段完成。

## 7. 外部决策与生产门槛

唯一无法在文档中替用户完成的是实际供应商账号/模型、凭据、生产域名/基础设施和实际成本额度。接入者必须提供供应商能力清单（幂等、取消、状态查询、参数、限流、输出有效期）并通过适配器契约测试；不支持恢复核对的供应商不能宣称可自动安全重试。

默认值已在本文给出，无需 AI 自行猜测；生产启用前根据供应商能力验证并集中配置。是否启用 Credits 是另一个未来产品变更，首期明确不启用。

## 视频编辑器运行

新增 editor-worker 与 FFmpeg 镜像依赖。迁移 0009 增加工程和导出表；Worker 通过 PG 领取 queued，输出经既有资产体系保存。操作、限制和恢复语义见 [视频编辑器](video-editor.md)。该功能不表示 Celery、通用上传或多轨剪辑已实现。

迁移 0010 为工程、渲染任务及资产增加项目复合外键；editor_document_assets 和 editor_render_assets 显式登记源引用，防止跨空间引用及素材被物理误删。

迁移 0011 增加 upload_files。登录用户的图片、视频和普通文件由浏览器直传七牛；API 只签发受限上传凭证，并在确认对象后记录。生成图片和文生视频仍写入私有对象存储，不改走七牛。跨空间作品汇总仍未接入。

## ADR-024 用户与任务运营后台

已接入真实用户列表、状态变更、会话撤销，以及全平台生成任务安全元数据、详情和排队取消；审计随事务落库。运行中视频取消仍未开放，当前 Provider 不支持；不提供重试付费生成、强制终态、私有素材查看或用户物理删除。审计记录已持久化，独立审计检索页面仍待实现。

## ADR-025 资产与导出后台

已接入只读资产盘点和导出元数据列表/详情、排队导出取消。支持权限拦截、字段脱敏、筛选分页、非删除登记大小统计及取消事务审计。不提供管理员媒体预览/下载/清理、运行中进程终止或一键重新渲染；审计检索页面仍未实现。


### ADR-026：局部重绘与首帧视频

已接入图片编辑器、输入保存、模型能力指定与异步任务。重绘首期支持 OpenAI edits 协议的 `gpt-image-1`、`gpt-image-1-mini`、`gpt-image-1.5`，按 ADR-027 复用 `text_to_image` 图片生成指定，无独立重绘模型配置；另外支持当前 qwen-image-2.0（多模态生成接口）、qwen-image-3.0 / pro（images/generations 参考图）的图像编辑及应用层蒙版合成。图生视频统一使用 `text_to_video` 指定。Wan 2.1–2.6 单首帧模型使用 `img_url`；目录声明可接收图片的 `wan3.0-video` 使用 `media` 首帧。当前只开放 5 秒，清晰度选项由后端返回。新模型须验证协议后扩展适配名单。

部署需要 `alembic upgrade head`（0014），同步 Pillow 依赖并重启 API、image-worker、video-worker。image-worker 每小时清理超过 24 小时且没有任何任务引用的输入；先提交 deleted 意图，再删除对象和元数据。失败会记录错误类型并在下轮重试；任务引用的输入保留。

验证供应商协议依据：[OpenAI 编辑接口](https://developers.openai.com/api/reference/resources/images/methods/edit)、[DashScope 首帧视频接口](https://www.alibabacloud.com/help/en/model-studio/legacy-image-to-video-api-reference)。自动测试使用明确的供应商替身；真实调用需管理员配置对应模型、区域匹配的服务端 endpoint 与凭据。不能以替身通过声称真实供应商验收完成。


ADR-027：图片操作统一使用图片生成模型，视频操作统一使用视频生成模型。image_inpaint/image_to_video 仅表示操作类型，不再提供独立指定或新配置类别；历史记录保留且不影响新请求，已排队任务保持原模型快照。Qwen Image 3.0 的选区通过参考图引导，再由应用蒙版合成保证区域外不变，不宣称供应商原生支持 mask。

Skill Layer：image.outpainting 已在既有任务/Worker 链路内接入，支持 Git 默认模板、后台显式绑定、停用准入与不可变任务快照。image.inpainting/video.image_to_video 暂仅预留路由，仍沿用原流程；SceneAnalyzer 尚无生产实现；A/B 分流、自动规划及技能成本/成功率后台尚未实现。本轮验证使用模拟 Provider，不能证明真实模型扩图视觉质量。

### LangChain 创意对话（ADR-039）
- 安装锁定依赖后，迁移 `0020_creative_chat`；重启 API 与 text-worker。
- 在 `backend/model-endpoints.yaml` 按 `model-endpoints.example.yaml` 的 deepseek 配置填写服务端密钥。官方默认入口 https://api.deepseek.com，模型 deepseek-chat。密钥不得提交到仓库。
- 后台模型目录登记 deepseek-chat / text_generation，再在业务指定中将文本生成指定为该配置。后续换模型也通过业务指定，不修改前端。
- 会话基础链路及 JSON 输出由模拟供应商测试验证；没有真实 DeepSeek 密钥时不能声称语义准确率或真实模型连通已验收。
- 暂不支持 RAG 或图片附件，图片意图支持消息内点击生成，视频意图仍进入现有生成页确认后执行。

对话使用 LangChain astream 接收模型增量，只解析 reply 文本；Worker 每至多 300ms 保存部分回复，前端每 400ms 读取活动回合并逐步显示。不是 SSE 推送。完整结果校验成功前不展示生成方案；中断保留部分文字，禁止自动重发付费请求。

对话图片交互更新：用户已授权识别图片生成意图后直接生成。Worker 在新回复完成校验时，同事务创建图片任务并关联消息；历史读取不触发生成，失败仅显式重试。文字在图片容器外，生成期间复用动画骨架，工具栏位于回复底部。

自动图片生成要求 text-worker 与 api、image-worker 使用一致的对象存储配置；部署更新 environment 后需重建容器，单纯 restart 不会载入新的环境变量。
