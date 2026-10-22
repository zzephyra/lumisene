# Lumi Architecture

状态：架构基线；实现细则修订于 2026-09-27。本文约束产品范围与工程实现，不表示功能已实现。决策记录见 `docs/adr/`。

唯一入口是本文，不恢复已移除的 architect.md。执行级契约见 [实现规范索引](docs/specs/README.md)，当前代码差距见 [运行与验收](docs/specs/operations-and-acceptance.md)。本轮用户已授权完善文档，细化与修订记录于 [ADR-014](docs/adr/014-executable-contracts.md)。

本文中的 MUST、SHOULD、MUST NOT 是强制程度。改变这些约束必须先写 ADR，得到确认后再改本文和代码。

## 1. System Overview

Lumi 是按项目组织的视频生成平台。用户在项目内上传资料、对话检索、确认记忆、提交视频生成，并查看任务和成片。

典型流程：创建项目 → 上传资料 → 对话并检索项目知识 → 编辑生成提示词和参数 → 用户明确提交生成 → 查看任务状态 → 预览与下载视频。

首期包括：登录、项目与成员、项目内对话、知识库与 RAG、项目记忆、视频生成、资源和生成记录。

首期增加项目内单视频轨道非破坏性剪辑、工程保存与异步 FFmpeg 导出，见 [ADR-022](docs/adr/022-video-timeline-editor.md)。

首期不包括：多智能体自治、模型训练、支付和 Credits 账本。订单、计费及 Credits 如后续引入，仍必须遵守本文数据约束。

项目是数据、检索和记忆的隔离边界。默认不支持跨项目共享，也不支持全局用户记忆。

LLM 可以提出生成方案，但不能绕过用户提交、权限、参数校验或额度检查直接创建付费生成。

## 2. Architecture Principles

优先级：Correctness > Maintainability > Simplicity > Extensibility > Cleverness。

默认形态是模块化单体加异步 Worker。没有明确需求时，不引入微服务、事件溯源、CQRS、Kubernetes 或额外的框架。

- PostgreSQL MUST 是唯一业务事实源。
- Elasticsearch MUST 只作为可删除、可重建的搜索索引。
- Redis MUST NOT 保存唯一业务事实。
- 对象存储 MUST 保存文件和媒体字节；归属和生命周期以 PostgreSQL 为准。
- 长时间任务 MUST 离开 HTTP 请求。
- AI 供应商调用 MUST 经过 Model Gateway。
- Domain MUST NOT 依赖 FastAPI、SQLAlchemy、Elasticsearch、Redis、LangChain、Celery 或供应商 SDK。

## 3. Technology Stack

| 层次 | 选择 | 约束 |
| --- | --- | --- |
| 前端 | React、TypeScript、Vite | SPA |
| 路由与服务端状态 | React Router、TanStack Query | 不把服务端状态放进全局 store |
| UI | Tailwind CSS、shadcn/ui | 不并行第二套组件库 |
| 后端 | Python、FastAPI、Pydantic | Router 保持轻量 |
| 数据访问 | SQLAlchemy 2 async、asyncpg、Alembic | 唯一 ORM 和迁移工具 |
| 事实数据库 | PostgreSQL | Source of Truth |
| 检索 | Elasticsearch | 全文、过滤、聚合、向量 |
| 异步 | Celery；Redis 作 broker | 任务真值在 PostgreSQL |
| 文件 | S3 兼容对象存储；开发环境 MinIO | boto3 |
| AI 文本实现 | LangChain | 只存在于文本适配器 |
| 工具 | uv、pnpm、Ruff、ESLint、Prettier | 不混用包管理器 |

视频编辑器允许 Remotion / Remotion Player、dnd-kit 及仅作用于编辑会话的 Zustand；服务端任务状态仍由 TanStack Query 管理。

首期不引入 React Hook Form、Zod、LangGraph、第二套向量数据库或 Celery result backend。出现具体需求时再评估。

版本在初始化时锁定到 `uv.lock` 和 `pnpm-lock.yaml`。不得增加第二套 ORM、任务队列、UI 系统或向量数据库。新增运行时依赖需说明现有工具无法满足的具体需求。

## 4. Architecture Diagram

```text
React SPA
  │  HTTP / SSE
  ▼
FastAPI
  ▼
Application Service
  ├── Domain rules
  ├── PostgreSQL Repository
  ├── AI Port ── Model Gateway ── Provider Adapter
  │                 └── LangChain 仅用于文本 / RAG 适配器
  ├── Search Gateway ── Elasticsearch
  └── Storage Gateway ── Object Storage

同一 PostgreSQL 事务：业务写入 + Outbox
  ▼
Dispatcher ── Celery / Redis ── Worker
  Worker 调用同一套 Application Service
```

## 5. Backend Architecture

```text
Router / Worker
  → Application Service
    → Domain
    → Repository / Gateway
      → Infrastructure
```

```text
Lumi/
├── ARCHITECTURE.md
├── frontend/
│   ├── src/
│   │   ├── app/                 # 路由、Provider、应用入口
│   │   ├── features/            # auth/projects/chat/knowledge/memory/generation/assets
│   │   ├── components/ui/       # 无业务逻辑的通用 UI
│   │   ├── api/                 # OpenAPI 生成类型、统一请求客户端
│   │   └── lib/                 # 少量通用工具
│   └── package.json
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── core/                # 配置、认证、安全、日志、异常
│   │   ├── modules/<module>/
│   │   ├── infrastructure/      # Search、Storage、Model Gateway、Outbox
│   │   └── workers/             # 执行入口、Outbox 分发、同步及恢复
│   ├── alembic/               # 与现有迁移目录一致
│   ├── tests/
│   └── pyproject.toml
├── infra/
└── docs/adr/
```

Router MUST 只处理 HTTP、校验、认证上下文和响应序列化。

Router MUST NOT 写 SQL、编排 RAG、调用 Elasticsearch、调用 LangChain 或调用供应商 SDK。

最外层 Service MUST 划定事务和用例边界；跨模块调用共享同一 UoW，内部 Service/Repository 只 flush、不 commit。Repository MUST NOT 做权限策略。供应商适配器 MUST NOT 决定业务状态。详见 [数据与事务](docs/specs/data-and-transactions.md)。

Worker MUST 复用 Service，禁止复制一套业务逻辑。

Python 公共接口 MUST 使用类型标注。Pydantic DTO 与 ORM 模型 MUST 分开。异步代码 MUST NOT 调用阻塞网络客户端。网络请求 MUST 统一超时、取消与有限重试。

模块目录在文件变长之前保持扁平：

```text
backend/app/modules/<module>/
  router.py
  schemas.py
  service.py
  domain.py
  repository.py
  models.py
```

`models.py` 是 ORM。领域状态和迁移规则放在 `domain.py`。

## 6. Frontend Architecture

```text
frontend/src/
  app/             # 路由、Provider、入口
  features/        # auth、projects、chat、knowledge、memory、generation、assets
  components/ui/   # 无业务通用组件
  api/             # OpenAPI 生成的类型和客户端
  lib/
```

- TypeScript MUST 使用 strict。禁止用 `any` 或 `@ts-ignore` 掩盖边界数据。边界数据 MUST 先校验再使用。
- 页面按业务 feature 组织。组件渲染 UI，hooks 封装交互与请求，api 层集中处理鉴权、错误及取消。
- 服务端状态 MUST 由 TanStack Query 管理。
- 客户端交互状态 SHOULD 留在组件 state。首期 MUST NOT 引入全局 store 来复制任务状态。
- API 类型 MUST 从 OpenAPI 生成。禁止另写一套可能漂移的类型。
- 缓存键 MUST 包含 `project_id`。切换创作空间时 MUST 取消旧请求和旧事件流，禁止旧响应写入当前空间。个人空间的获取缓存按登录身份隔离。以后的跨空间汇总缓存必须包含登录身份和筛选条件，退出登录时清理。
- 颜色、字体、间距 MUST 使用统一 token。MUST 复用 `components/ui`，禁止每个页面重建按钮、弹窗、表格或引入另一套样式方案。
- 每个异步界面 MUST 有 loading、empty、error、success。长任务展示服务端真实状态、失败原因和允许的操作，不伪造进度。
- 提交按钮可以防重复点击，最终去重 MUST 由后端幂等保证。服务端确认前不得显示生成成功。
- 默认桌面优先并支持窄屏。交互元素 MUST 提供可访问名称、键盘操作和明显的焦点状态。

基础页面：登录后的个人创作空间、创作空间管理、工作台、对话、知识库、记忆、生成记录、资源库、空间设置。前台称创作空间，底层仍是 Project。详见 [ADR-021](docs/adr/021-personal-creative-space.md)。

## 7. Module Boundaries

| 模块 | 拥有 | 不拥有 |
| --- | --- | --- |
| auth | 用户、会话 | 项目角色 |
| projects | 项目、成员、角色 | 生成与检索 |
| chat | 会话、消息、chat_run | 索引写入、供应商 SDK |
| knowledge | 文档、版本、分块、入库状态 | 其他模块的表 |
| memory | 已确认的项目记忆 | 自动把对话变成记忆 |
| generation | 生成任务、尝试、幂等键 | 媒体字节 |
| assets | 资源元数据和签名访问 | 业务状态机 |
| editor | 编辑工程、不可变渲染快照、异步导出任务 | 供应商生成、其他模块的表 |
| stories | 项目剧本名称、介绍、版本和封面引用 | 剧本原文、人物分析、生成资源字节 |

Search、Storage、Model Gateway、Outbox 属于 `backend/app/infrastructure/`，不是业务模块。

模块 A MUST NOT 读取或写入模块 B 的表。需要数据时调用对方的 Application Service 或 Port。

禁止循环依赖。发现环时停止并重新划分边界，不得用延迟 import 掩盖。

## 8. Dependency Direction

```text
auth
projects    → auth
knowledge   → projects, assets, search port, embedding port
memory      → projects, search port
chat        → projects, knowledge, memory, text AI port
generation  → projects, assets, model capability, video port
assets      → projects, storage port
```

基础设施可以被 Service 注入。适配器 MUST NOT import 业务 Service。

只有出现第二次真实复用时才提取公共模块。MUST NOT 预先建立万能 BaseService、通用 Agent 框架或堆积业务代码的 utils。

## 9. PostgreSQL Architecture

PostgreSQL MUST 保存：用户、会话、成员权限、项目、消息、对话运行、文档与分块、记忆、生成任务与尝试、资源元数据、模型配置、Outbox，以及未来的订单、支付、Credits 和 Quota。

所有业务 Create、Update、Delete MUST 首先作用于 PostgreSQL。普通业务查询直接查询 PostgreSQL。权限、余额、支付、任务状态、用户状态、额度等最终判断 MUST 查询 PostgreSQL。

| 实体 | 核心职责 |
| --- | --- |
| users / projects / project_members | 身份、项目与 OWNER / MEMBER。完整 RBAC 以后再扩展 |
| conversations / messages / chat_runs | 对话、持久消息、流式生成运行状态 |
| documents / document_versions / chunks | 原文件引用、版本、解析文本、分块、引用坐标 |
| memories | 项目记忆、来源、版本、有效状态与撤销记录 |
| generation_tasks / generation_attempts | 视频任务、供应商调用尝试、状态和失败记录 |
| assets | 视频/图片等资源归属、对象键、媒体属性与来源 |
| model_configs | 服务端允许的模型、能力、参数限制及密钥引用 |
| outbox_events / event_deliveries | 可靠业务事件、消费者执行与恢复状态 |

约定：

- 主键 UUID。
- 时间 UTC，API 使用 ISO 8601。
- 列名 snake_case。
- 项目资源 MUST 有非空 `project_id`。全局用户与系统级模型配置属于明确例外。
- 跨资源关系使用外键和复合约束，防止不同项目的会话、文档和资源被关联。
- 项目资源 Repository MUST 要求 `project_id`，MUST NOT 提供无范围的对外 `get_by_id`。ADR-024 / ADR-025 的专用管理列表是受平台管理员鉴权的元数据查询例外；详情与取消仍以 project_id + task_id 定位。
- `project_id` MUST 来自已授权路由上下文，不信任请求体中的归属字段。

Session MUST 由统一 Unit of Work 管理。禁止业务代码到处创建 Session。

删除项目时先在 PostgreSQL 标记不可访问并写清理事件，再异步清理索引和对象。清理完成前也不得返回残留数据。

详见 [ADR-002](docs/adr/002-postgresql-source-of-truth.md)。

## 10. Elasticsearch Architecture

Elasticsearch MUST NOT 作为主数据库，也 MUST NOT 判断权限、余额、支付、配额、用户状态或任务真值。它只承担全文、模糊、组合、建议、高性能检索和聚合，保存可删除、可重建的 Derived Data。ES 中不得存在无法从事实源恢复的唯一数据。

首期索引：

| 索引 | 别名 | 内容 |
| --- | --- | --- |
| `knowledge_vN` | `knowledge_read` | 分块文本与 embedding |
| `memory_vN` | `memory_read` | 记忆候选 |

生成任务列表走 PostgreSQL。

搜索流程：

```text
已授权 project_id
  → Elasticsearch（服务端强制 project_id）
  → 命中 ID
  → PostgreSQL 回查版本、删除和权限
  → 有效内容才进入响应或模型上下文
```

项目内容、RAG 分块和任务搜索的结果 MUST 回查 PostgreSQL，按命中顺序输出有效结果。ES 中的状态只是候选。PostgreSQL 为 `succeeded` 时，不得用索引里的 `running` 覆盖。被删除、失权或过期的命中 MUST 丢弃，不能把 ES 文本直接返回给用户或模型。

搜索聚合是最终一致的统计，MUST NOT 用作计费或权限判断。私有项目的聚合 MUST 限定在 PostgreSQL 授权后的项目范围内。

ES 故障时，普通业务和任务状态查询继续通过 PostgreSQL 工作。知识检索 MUST 明确返回暂不可用，不得静默假装检索成功。

Embedding 模型、维度、分块规则、mapping 和检索参数 MUST 版本化。更换 embedding 模型 MUST 重建对应索引。

详见 [ADR-003](docs/adr/003-elasticsearch-search-index.md)。

## 11. PG → ES Synchronization

MUST 使用 Transactional Outbox：

```text
业务记录 + outbox_events  →  同一事务 commit  →  业务成功
Dispatcher  →  Celery  →  Index Worker  →  Elasticsearch
```

普通 Service MUST NOT 连续调用 `postgres.save()` 和 `elasticsearch.index()`。业务写入及重建注册/切换使用共享的 PG 写入屏障协议，详见 [任务与同步](docs/specs/tasks-and-events.md)。MUST NOT 为两边同时成功引入分布式事务。提交成功后，即使 Elasticsearch 不可用，业务操作仍成功。

Outbox 至少包含 `event_id`、`event_type`、`aggregate_id`、`project_id`、`aggregate_version`、`schema_version`、`payload`、`created_at`，以及重试和投递状态。

- 投递至少一次，消费者 MUST 幂等。消息成功消费前不得提前确认。
- 更新 MUST 按聚合版本执行，旧事件不得覆盖新文档。
- 删除 MUST 使用带版本的墓碑和幂等删除，防止乱序消息恢复已删除内容。
- 暂时错误 SHOULD 指数退避，并带抖动和最大次数；永久错误进入 PostgreSQL 失败记录，可人工重放并报警。
- 队列丢失后 MUST 能从 PostgreSQL 扫描未完成记录重新投递，不能只依赖 Redis。
- 重建 MUST 注册新目标、构建 PG 快照、追平增量与删除，校验后切换 alias。写入屏障、快照恢复和回滚窗口严格遵循 [任务与同步](docs/specs/tasks-and-events.md)，不得把自增序列当成提交顺序。
- SHOULD 定期按更新时间、版本和数量对账，修复漏索引、过期索引及未清理数据。

`ingestion_status` 与 `index_status` MUST 分开。允许解析成功而索引失败。

索引未追平时，检索 SHOULD 报告资料仍在处理，而不是把旧版本当作当前资料。

详见 [ADR-004](docs/adr/004-pg-es-transactional-outbox.md)。

## 12. AI Architecture

```text
Business Service
  → AI Application Port
    → Model Gateway
      → Provider Adapter
        → Provider SDK / API
```

业务代码 MUST NOT 知道具体 SDK。能力至少区分 `text_generation`、`embedding`、`text_to_video`、`image_to_video`。不得为了统一接口抹平供应商差异。

按 ADR-027，除 ADR-035 专用扩图外，所有图片操作统一使用 text_to_image 指定，所有视频操作统一使用 text_to_video 指定；其他业务按能力指定。操作类型与指定类别分离，局部重绘和图生视频不得单独指定模型。前端展示这个模型，不能改选，也不能在请求里提交模型 ID。前端 MUST NOT 猜测供应商参数。详见 [ADR-019](docs/adr/019-business-model-assignment.md)。

供应商的 429、5xx、超时、网络错误和内部错误 MUST 被分类。结果不明时先查询，禁止盲目再次提交付费请求。

调用日志 SHOULD 包含 provider、model、latency、status、error_type、retry_count、usage。日志 MUST NOT 包含 API Key、密码、会话令牌、原始提示词或文档正文。

## 13. LangChain Boundary

LangChain MUST 只实现文本侧的模型抽象、提示词、结构化输出和 RAG 组装。

```text
Domain / Application
  → AI Port
    → LangChain Adapter
```

Domain MUST NOT import LangChain。

MUST NOT 把普通业务、权限、Outbox、视频轮询或取消包装成 Chain、Agent、Tool 或 Graph。

首期 MUST NOT 引入 LangGraph，MUST NOT 实现自治多智能体。模型不能静默修改记忆、权限或生成任务。

检索到的文本是不可信资料，不得覆盖系统指令、改变权限或触发工具调用。

详见 [ADR-008](docs/adr/008-model-gateway-langchain-boundary.md)。

## 14. Model Gateway

Gateway MUST 是所有模型调用的唯一出口，包括 LLM、Embedding 和视频生成。

未提交的 `model-endpoints.yaml` 声明可登记的供应商、中英文别名、模型和支持参数。PostgreSQL 中的 `model_configs` 保存已经登记的模型、能力、参数和密钥引用。密钥明文 MUST 只存在于服务端配置，接口 MUST NOT 返回明文。目录写入只允许平台管理员，成员只能读取已启用配置且响应不含 secret_ref。管理页 MUST NOT 发起供应商调用。文本补全和图片生成都由独立进程在数据库事务外调用 OpenAI 兼容适配器；图片字节写入私有对象存储，接口地址和密钥只来自服务端配置。文生视频由独立进程领取 queued 记录，在事务外调用已指定的 text_to_video 适配器，成片写入私有对象存储；提交结果不明时保持 submitting 且不得重发。ADR-026 开放 image_inpaint 局部重绘与 image_to_video 单首帧生成，复用图片/视频任务与 Worker；私有输入持久化并验证项目归属，Pillow 负责图片解码与蒙版转换。

Generation Service MUST NOT 直接依赖 Polling 或 Webhook。它只消费 Provider 返回的远程观察结果。

首期默认状态同步是 Polling。Provider 可以声明自己使用 Polling 或 Webhook。某个供应商以后改用 Webhook 时，只替换该 Provider 的同步方式，不改任务状态机。首期 MUST NOT 为 Webhook 增加公网入口、验签框架或独立事件基础设施。真正接入 Webhook 时，回调仍 MUST 验签、限时并去重，再转换成同一种远程观察结果。

新增供应商 MUST 增加适配器和能力声明，而不是在 Router 或前端增加分支。

详见 [ADR-011](docs/adr/011-video-status-sync.md)。

## 15. Async Task Architecture

以下工作 MUST 异步执行：视频生成、长文本模型调用、文档解析、Embedding、批量处理、索引和重建。

禁止：

```text
HTTP Request → 等待数分钟 → 返回结果
```

也禁止用 FastAPI BackgroundTasks 完成上述工作。数据库事务 MUST NOT 包住供应商请求或文件上传。

公开状态：

```text
queued → running → succeeded | failed | canceled
```

仅视频任务可以额外使用 `submitting` 和 `cancel_requested`。终态不可回退。`cancel_requested` MUST NOT 被展示为 `canceled`。供应商不支持取消时必须明确返回。状态迁移 MUST 通过 Service，并用版本条件更新。

视频生成链路：

1. 前端提交显式确认后的 prompt、结构化参数及参考资源 ID，并发送 `Idempotency-Key`。服务端解析该项业务当前指定的模型；任务保存模型配置 ID 和版本快照。客户端不提交模型 ID。
2. Service 校验成员权限、项目资源归属、模型能力和参数；如启用额度，在同一 PostgreSQL 事务中预留额度。
3. PostgreSQL 保存任务、不可变请求快照与 Outbox 事件，返回 202 和 `task_id`。
4. Worker 领取任务，调用视频供应商适配器；提交成功后保存 `provider_task_id`，通过 Provider 返回的远程观察结果获取进展。
5. 将输出保存到受控对象存储，确认对象存在，再在 PostgreSQL 事务中创建 Asset、关联结果并标记成功。
6. 前端轮询任务 API；成功后获取短期签名链接进行预览或下载。

完整允许转移见 [任务与同步](docs/specs/tasks-and-events.md)，包括 submitting 确定失败、未决提交、提交期间取消及 cancel_requested 失败。未决结果保持原状态并设置 reconciliation_required，不能因超时虚构 failed/canceled。

- 幂等唯一约束是 `(project_id, actor_id, operation, idempotency_key)`，并校验请求哈希；同键不同请求返回 409。
- 领取任务 MUST 使用租约和心跳。超时后由恢复任务接管；不得让并发 Worker 重复执行同一提交。
- 外部提交超时、结果不明时，先以供应商幂等键或查询接口核对。无法确认时进入人工核对流程，禁止盲目重试导致重复收费。
- 用户重试失败任务创建新任务并保留原任务关联；底层瞬时失败重试记录在 `generation_attempts`。
- 若启用 Credits，预留、结算和释放 MUST 使用 PostgreSQL 唯一业务键与账本保证幂等，不得根据 Elasticsearch 或供应商重复回调重复扣费。

任务记录 SHOULD 包含 id、type、status、progress、input、result、error、retry_count、max_retries，以及 created、queued、started、finished 时间。是否全部落列由该用例决定，但状态和时间必须足以恢复。

可靠性 MUST 覆盖：重试、超时、幂等、重复执行、Worker 崩溃、供应商超时、429、5xx、恢复和取消。

详见 [ADR-005](docs/adr/005-celery-redis-workers.md) 与 [ADR-009](docs/adr/009-task-state-machine.md)。

## 16. Chat, RAG, and Memory

### 16.1 对话

POST 创建持久消息和 `chat_run`，返回运行 ID。Worker 执行模型调用，浏览器用经过鉴权的 SSE 读取事件。事件最少包含 `event_id`、`run_id`、`type` 和 `data`，类型统一为 `started` / `delta` / `citation` / `completed` / `failed` / `snapshot`。

用户消息与运行记录先入 PostgreSQL。助手最终消息、引用及模型调用元数据写入 PostgreSQL 后才能发送 `completed`。短期流事件可进入 Redis 并设置保留期，最终业务结果始终来自 PostgreSQL。断线不自动取消运行；重连使用 `Last-Event-ID`，事件已过期则返回 PostgreSQL 中的运行快照。失败的部分输出 MUST NOT 标成完整答案。

每个会话同时只允许一个活跃 `chat_run`，通过 PostgreSQL 约束或锁保证；并发提交返回 409。上下文长度与输出 token MUST 设置上限，超限执行有版本记录的摘要。系统提示词和提示词模板 MUST 在后端集中管理、版本化，不能散落在 Router 或前端。

同项目会话可使用项目记忆；会话历史仍按 `conversation_id` 隔离。禁止通过邮箱、相似度或用户 ID 进行跨项目记忆召回。

### 16.2 RAG

入库链路：

```text
Upload → Parse → Normalize → Chunk → Embedding → Index → Retrieval
```

上传并校验文件 → PostgreSQL 文档记录与 Outbox → 异步解析 → 规范化分块 → PostgreSQL 保存原文、分块、页码/段落位置与版本 → Embedding → Elasticsearch 索引。PostgreSQL 单独记录 `ingestion_status` 与 `index_status`，允许“解析成功、索引失败”，不能把两者混为一个状态。

检索链路：授权项目 → 查询规范化 → Elasticsearch 项目内全文/向量混合召回 → PostgreSQL 校验命中版本、来源和可访问性 → 可选重排 → token 预算裁剪 → 组装上下文 → 模型回答并提供引用。

- 分块规则、embedding 模型/维度、索引映射和检索参数 MUST 版本化。切换 embedding 模型 MUST 重建对应索引，禁止混用不兼容向量。
- embedding 是可重新计算的派生数据；不能只在 Elasticsearch 保存分块原文、来源或唯一生成记录。
- 文档更新后旧版本默认不可用于 RAG；索引未追平期间应报告资料处理中。
- 引用至少包含 `document_id`、`document_version`、`chunk_id` 与可定位的页码/段落，最终引用关系 MUST 持久化到 PostgreSQL。
- 无有效证据时明确说明。检索文本是非可信资料。

解析 MUST 经过统一 Parser。首期格式为 PDF、DOCX、TXT、Markdown。业务代码不得按文件格式分支。见 [ADR-012](docs/adr/012-document-parser.md)。

### 16.3 项目记忆

记忆用于项目内稳定事实，如角色设定、视觉风格和用户确认的创作要求。原始对话不是自动可信的长期记忆。

- 默认由用户显式保存，或模型提出候选后由用户确认。模型不能静默改写既有设定。
- PostgreSQL 的 `memories` 保存聚合身份与当前修订，`memory_revisions` 保存内容、来源、版本、确认人和 `active` / `superseded` / `deleted` 状态，详见数据规范。
- 用户可查看、编辑、撤销和删除记忆；更新保留版本关系，不直接丢失来源。
- 召回先按授权项目和 `active` 状态过滤；Elasticsearch 仅生成候选，PostgreSQL 验证后才进入上下文。
- 当前明确指令与记忆冲突时优先处理当前指令，并提示用户是否更新记忆；不能因一次临时指令自动改写记忆。
- 不自动存储密钥、支付信息等敏感数据；记忆摘要不可成为原始事实的唯一副本。

## 17. Storage Architecture

```text
Asset
  ├── IMAGE
  ├── VIDEO
  ├── AUDIO
  └── FILE
```

字节 MUST 进入对象存储。PostgreSQL 保存 asset_id、object_key、校验和、MIME、大小、宽高、时长、状态、来源和项目归属。媒体字节及原始文件必须有备份与恢复策略；Elasticsearch 重建可读取 PostgreSQL 记录引用的原始对象。

桶 MUST 默认私有。签名 URL MUST 在授权后短期签发。

上传 MUST 限制格式、大小、数量和解析超时。外部 URL 导入 MUST 限制协议、目标地址和重定向，防止访问内网。

配置了七牛时，生成结果和编辑器导出经现有七牛适配器写入七牛；未配置时仍使用 S3 兼容存储。PostgreSQL 记录 `storage_provider` 与 `object_key`，签名 URL 不是永久地址。作品删除策略是系统设置，见 [ADR-036](docs/adr/036-qiniu-generated-assets.md)。

详见 [ADR-006](docs/adr/006-s3-object-storage.md) 与 [ADR-023](docs/adr/023-qiniu-direct-upload.md)。

## 18. API Architecture

统一前缀 `/api/v1`。项目资源嵌套在 `/projects/{project_id}` 下。

```text
POST /api/v1/projects
GET  /api/v1/projects/{project_id}
POST /api/v1/projects/{project_id}/conversations
POST /api/v1/projects/{project_id}/conversations/{conversation_id}/messages
GET  /api/v1/projects/{project_id}/chat-runs/{run_id}
GET  /api/v1/projects/{project_id}/chat-runs/{run_id}/events
POST /api/v1/projects/{project_id}/documents
GET  /api/v1/projects/{project_id}/search
GET/POST /api/v1/projects/{project_id}/memories
GET/PATCH/DELETE /api/v1/projects/{project_id}/memories/{memory_id}
POST /api/v1/projects/{project_id}/generation-tasks
GET  /api/v1/projects/{project_id}/generation-tasks/{task_id}
POST /api/v1/projects/{project_id}/generation-tasks/{task_id}/cancel
GET  /api/v1/projects/{project_id}/assets/{asset_id}
```

成功响应 MUST 使用明确 DTO，不增加无意义的统一 `data` 包装。列表使用 `items` 和 `next_cursor`。

错误 MUST 使用：

```text
error.code
error.message
error.details
request_id
```

HTTP 状态码 MUST 表达成败。禁止用 HTTP 200 表示失败。时间字段为 ISO 8601 UTC。

生成提交 MUST 接受 `Idempotency-Key`。相同键和相同请求返回原任务；相同键、不同请求返回 409。长任务创建成功返回 202 和 `task_id`。

分页 MUST 有默认值和上限。API MUST NOT 返回 ORM 对象、供应商原始响应、密钥或内部堆栈。

变更公开 URL、字段或错误码视为公开 API 变更，MUST 在变更说明中写出，MUST NOT 静默修改。

## 19. Authentication

首期使用服务端会话 Cookie：HttpOnly、Secure、SameSite。变更请求 MUST 校验 CSRF。会话撤销以 PostgreSQL 为准。

CORS MUST 使用明确白名单。禁止携带凭据并反射任意 Origin。

认证与授权 MUST 分开。登录只证明身份。

详见 [ADR-007](docs/adr/007-cookie-session-auth.md)。

## 20. Authorization

每个项目请求 MUST 先认证，再从 PostgreSQL 检查成员身份。

首期只有两种成员关系：

- OWNER：管理项目及其成员。
- MEMBER：在项目内编辑内容并提交生成。

平台管理员不是项目角色。`users.platform_admin` 只由管理员命令设置，默认 false，接口不能修改。它授权全局模型目录、业务模型指定、普通用户状态与会话管理，以及跨项目生成任务、资产、视频导出运营元数据查询和受状态机约束的排队任务取消操作。资产仅允许盘点，视频导出仅允许 queued 取消，详见 [ADR-025](docs/adr/025-admin-assets-exports.md)。它不授予项目成员身份，也不开放提示词、对话、知识、记忆或私有媒体内容。具体边界见 [ADR-024](docs/adr/024-admin-users-generation.md)。非管理员访问管理接口返回 404。详见 [ADR-018](docs/adr/018-model-admin-control.md) 与 [ADR-019](docs/adr/019-business-model-assignment.md)。

MUST NOT 在首期实现 Role、Permission、Resource、Policy 组成的 RBAC。数据模型 SHOULD 把角色存成可扩展字段，而不是把权限判断写死在多个布尔列上。ADMIN、EDITOR、VIEWER 和细粒度权限以后必须通过新的 ADR 引入。

详见 [ADR-013](docs/adr/013-project-membership-roles.md)。

敏感操作 MUST 在执行时重新校验，不能只依赖进入页面时的缓存。

Worker 在新生成、文本或 embedding 调用前 MUST 重新检查项目、资源和发起人。项目已删除或权限已撤销时 MUST 停止新增提交。已提交任务的查询、尽力取消和清理由受限系统恢复身份收尾，不得因原发起人撤权永久卡住。

Elasticsearch 过滤、缓存键、对象路径、任务事件和日志上下文 MUST 携带项目范围。

A 项目的用户 MUST NOT 读取、检索、引用、修改或签名访问 B 项目的消息、记忆、文档、任务和资源。

## 21. Billing

首期 MUST NOT 实现订单、支付、Credits 或 Quota 账本。

诊断用的供应商用量可以记在 `generation_attempts`，但 MUST NOT 当作余额。前端估价和 Elasticsearch 聚合 MUST NOT 作为费用或余额。

启用计费前 MUST 新写 ADR。账本 MUST 放在 PostgreSQL，并用业务幂等键防止重复扣费。

详见 [ADR-010](docs/adr/010-billing-deferred.md)。

## 22. Error Handling

统一错误类型：

```text
ApplicationError
DomainError
ValidationError
AuthenticationError
AuthorizationError
NotFoundError
ConflictError
RateLimitError
ExternalServiceError
ProviderError
TimeoutError
```

业务错误 MUST 映射为明确错误码，由统一异常处理器转换。

禁止：

```python
try:
    ...
except Exception:
    pass
```

禁止吞掉异常后返回空成功。异常日志 MUST NOT 输出密钥。

## 23. Logging

使用 structlog 输出结构化日志。

业务日志 SHOULD 包含 `request_id`、`trace_id`、`user_id`、`project_id`、`task_id`、`run_id`、`generation_id` 中实际存在的字段。

默认 MUST NOT 记录原始提示词、文档正文、会话令牌、密码、token 和供应商密钥。

## 24. Observability

健康检查 MUST 区分进程存活和依赖就绪。

SHOULD 观察：API 延迟、任务排队时间、供应商错误、Outbox 积压、索引延迟、重试失败。

首期不部署完整 APM。引入 OpenTelemetry 或指标系统时不得改变业务边界。

## 25. Security

MUST 覆盖：认证、授权、输入校验、文件校验、限流、密钥管理、SQL 注入、XSS、CSRF、SSRF、上传、签名 URL 和供应商回调验签。

Secret MUST NOT 写入仓库。配置样例不得包含真实凭据。

供应商密钥仅后端可读。PostgreSQL 保存密钥引用，接口 MUST NOT 返回明文。

供应商回调 MUST 验签、限时并去重。供应商状态经过适配与 Service 验证后才进入 PostgreSQL。对象桶默认私有。

## 26. Testing

后端使用 pytest。涉及事务、隔离和索引的测试 MUST 使用真实测试用 PostgreSQL 和 Elasticsearch。供应商调用使用替身。替身必须明确标记，且不得进入生产配置。

前端使用 Vitest 与 Testing Library。核心路径“创建项目 → 对话 → 生成 → 查看结果”使用 Playwright。

CI MUST 运行格式、lint、类型检查、必要测试和前端 build，并验证 OpenAPI 客户端同步。

首期 MUST 覆盖下列业务风险，不能仅测试函数是否按实现调用：

1. 跨项目读写、检索、引用和签名访问被拒绝。
2. PostgreSQL 已提交而 Elasticsearch 或 Redis 失败时，业务结果仍正确，恢复后可以重放并追平索引。
3. 重复事件、乱序事件、删除事件和重复回调不会覆盖新状态、复活已删除数据或产生重复资源。
4. 重复提交、Worker 崩溃、供应商超时和取消竞态不会产生重复外部任务或错误终态。
5. 对话断线可恢复；失败输出不会变成完整消息；失效分块不会被引用。
6. 索引可以从事实源重建，alias 切换后的结果和权限正确。

未运行的检查 MUST NOT 被写成已通过。

## 27. Deployment

开发环境用 Docker Compose 提供 PostgreSQL、Elasticsearch、Redis、MinIO、API、Worker 和 Vite 前端。发布时 CI 构建并推送同一提交的后端和前端镜像；CD 只拉取镜像、单独执行 Alembic 并更新服务。部署覆盖配置移除源码挂载，前端使用 Nginx 提供编译后的 SPA 和 API 代理。见 [ADR-040](docs/adr/040-ci-container-delivery.md) 与运行规范。

API、Worker、Outbox Dispatcher SHOULD 可以独立启动，并共用同一镜像中的不同命令。

生产启动 MUST NOT 自动建表。数据库变更只通过 Alembic。备份 MUST 包含 PostgreSQL 和对象存储，并 SHOULD 定期验证恢复。

首期不用 Kubernetes。

## 28. Architecture Constraints

### MUST

- PostgreSQL 是 Source of Truth。
- Elasticsearch 数据必须能够重建。
- AI 供应商必须通过 Model Gateway。
- 长任务必须进入异步系统。
- 项目资源必须按 `project_id` 隔离。
- 核心业务规则必须有测试。
- 模块必须遵守依赖方向。
- 业务写入和 Outbox 必须在同一 PostgreSQL 事务中。
- 公开状态必须使用统一任务词汇。

### SHOULD

- PostgreSQL 到 Elasticsearch 的同步保持异步。
- 优先复用已有 Service、Repository 和 Gateway。
- 优先使用已经选定的成熟组件。
- 优先使用简单、显式的实现。
- 模块保持扁平文件，直到文件本身变得难以阅读。

### MUST NOT

- 把 Elasticsearch 当作主数据库或权限、余额、任务真值来源。
- Router 直接访问数据库、搜索引擎或供应商 SDK。
- Domain 依赖 SQLAlchemy、LangChain、Celery 或 HTTP 框架。
- Business Service 直接调用第三方 AI SDK。
- 用 FastAPI BackgroundTasks 执行长任务。
- 静默修改公共 API、数据库结构或任务状态机。
- 静默改变技术栈或增加重复基础设施。
- AI Agent 在未确认时修改架构。

## 29. Forbidden Patterns

- `utils.py`、`utils2.py`、`service_v2.py`、`common_new.py` 这类平行副本。
- 无范围的 `get_by_id`。
- 请求体自行指定资源所属项目。
- 双写 PostgreSQL 和 Elasticsearch。
- 用 Celery 结果或 Redis 键作为任务真值。
- 把视频生成包成 LangChain Agent。
- 模型在没有用户确认时创建生成任务或改写记忆。
- 跨项目记忆召回。
- 生产环境 `create_all`。
- 硬编码密钥。
- 捕获 `Exception` 后忽略。
- 为了少写几十行代码新增一个大型依赖。
- 用假数据掩盖未实现的功能。

新增 Service、Repository、Gateway、队列或框架之前，必须能说明现有结构为什么不够。不能说明就修改现有代码。

## 30. Configuration

配置 MUST 通过统一 Settings 读取环境变量，并区分 development、testing、staging、production。

业务代码 MUST NOT 到处调用 `os.getenv`。

## 31. Change Rules

开始实现前必须阅读本文、相关 ADR 和受影响模块代码。每次变更应满足：

- 明确归属模块、API 契约、数据模型和状态迁移后再写代码。
- 先复用现有实现，不随意改目录结构、命名、依赖或代码风格。
- 业务数据先写 PostgreSQL；所有新增项目资源和检索入口必须带项目隔离。
- 外部服务必须经过 `infrastructure`；不能把 SDK 调用散落在 Router、组件和 Worker 中。
- 新增持久字段必须有迁移；变更 API 必须更新 OpenAPI 类型；变更行为必须覆盖相应风险测试。
- 不引入未请求的功能或大规模重构。开发替身必须明确标记并与生产配置隔离。
- 完成说明必须列出改动、已执行的验证和未解决限制。未执行的检查不能宣称通过。
- 引入新基础设施、跨项目数据共享、修改计费或状态模型前，先记录 ADR 并更新本文。

不能仅依靠提示词保证隔离和一致性。关键约束通过 `AGENTS.md`、CI 和边界测试落实。

## 32. Resolved Decisions

1. 视频状态同步：Provider 屏蔽 Polling 与 Webhook 的差异。首期默认 Polling，不为 Webhook 预建复杂基础设施。见 [ADR-011](docs/adr/011-video-status-sync.md)。
2. 知识库文件：首期实现 PDF、DOCX、TXT、Markdown。解析必须经过统一 Parser，业务代码不得按文件格式分支。后续格式通过新 Parser 接入。见 [ADR-012](docs/adr/012-document-parser.md)。
3. 成员角色：首期只有 OWNER 和 MEMBER。见 [ADR-013](docs/adr/013-project-membership-roles.md)。

默认文件上限、并发、保留周期、重试和运行限制已在 [运行与验收](docs/specs/operations-and-acceptance.md) 固定。生成参数来自版本化模型能力。首期不启用 Credits。接入阶段仍需选择并验证真实视频、LLM、Embedding 供应商，配置账号凭据和生产环境；不得把这些外部条件标记为已完成。

## 33. Implementation Order

初始化代码前，本文和 ADR 必须保持为当前约束。

1. 工程骨架、认证、项目权限、迁移、统一错误和日志、前端基础布局。
2. Outbox、Worker、视频适配器替身、任务状态机、对象存储和生成记录；先用受控替身打通端到端链路。
3. 持久对话、SSE、模型配置和真实文本供应商。
4. 文档解析、分块、异步索引、RAG 引用和索引重建。
5. 用户确认的项目记忆、隔离回归、恢复演练与部署验收。

第一次实现只建立当前步骤需要的骨架，不生成未验证的完整业务功能。

## 34. Implementation Contracts

以下为本文的规范性细则，代码评审必须按受影响主题检查：

- [数据模型、事务、幂等](docs/specs/data-and-transactions.md)
- [任务状态、可靠投递、索引恢复](docs/specs/tasks-and-events.md)
- [API、权限、上传与 SSE](docs/specs/api-and-access.md)
- [RAG、引用、上下文与记忆](docs/specs/rag-and-memory.md)
- [前端页面、组件、状态和交互](docs/specs/frontend.md)
- [运行默认值、当前差距与验收](docs/specs/operations-and-acceptance.md)

总架构不重复维护字段或完整状态表。改变细则中公开契约需要同步其调用方与测试；改变架构边界需要 ADR。用户已明确授权的文档修订可在记录决策后完成，无需为同一授权重复确认。

平台管理员另可管理创作技能目录（新增、编辑、激活、停用、软删除），定义与不可变版本保存于 PostgreSQL，归现有 AI 基础设施目录。见 [ADR-032](docs/adr/032-admin-skills.md)。不自动执行技能、不扩展项目内容访问权限。

扩图使用专用异步 image-out-painting 模型，见 [ADR-035](docs/adr/035-native-outpainting.md)。旧扩图 Skill 分类、蒙版和合成链路已移除；Skill 目录及其他操作保持原边界。

### 统一图像编辑（ADR-037）
ADR-037 取代 ADR-035 的新任务规则：扩图、局部重绘、参考图指令编辑统一使用 wanx2.1-imageedit；旧原生扩图仅用于已提交任务恢复。文生图及视频模型独立。编辑请求与查询复用已有持久化异步生命周期。

## 公开作品展示
按 [ADR-038](docs/adr/038-public-works.md)，用户明确公开的生成作品可在匿名个人主页展示。这是项目隔离的有限例外，私有资产与项目元数据仍需原有鉴权。

## 创意对话实现
[ADR-039](docs/adr/039-langchain-creative-chat.md) 落实 LangChain 文本适配器与项目级多轮会话。首版使用成对 chat_turns 持久化与轮询，复用文本 Worker；结构化生成意图只形成用户确认的方案，不自动生成媒体。

用户后续授权：图片方案可在对话内点击生成并展示结果。复用现有图片生成 Service、Worker 和资产存储；chat_turns 保存任务关联，任务与关联同事务提交，重复点击返回同一任务。视频仍通过生成页。图片编辑进入既有编辑器。

对话图片交互更新：用户已授权识别图片生成意图后直接生成。Worker 在新回复完成校验时，同事务创建图片任务并关联消息；历史读取不触发生成，失败仅显式重试。文字在图片容器外，生成期间复用动画骨架，工具栏位于回复底部。

## 剧本人物知识图谱

根据用户授权新增 characters 模块，管理人物档案、关系、剧本证据、分析任务与独立布局。人物图谱属于某一个剧本，不在项目侧栏单独出现。见 [ADR-043](docs/adr/043-story-scoped-character-graph.md)。严格版本化 JSONB 允许存储非关系人物属性，人物关系和项目外键仍使用显式列。React Flow 与 d3-force 负责图交互和布局；统一 Parser、既有对象存储及文本模型适配器支持分析。AI 建议需审核，不覆盖用户事实。见 [ADR-041](docs/adr/041-script-character-graph.md) 和 [设计规范](docs/specs/character-graph.md)。

人物形象资产按 [ADR-045](docs/adr/045-character-image-library.md) 独立于文本档案持久化；复用上传、生成任务和对象存储，现有图片 Worker 负责将生成结果绑定到人物，不新增模型调用通道。

ADR-046：storyline 模块管理剧本章节、场景、结构化正文和待确认 AI 草稿，复用 Story/Character Service 与现有文本 Worker。正式剧情仅人工保存或明确接受 AI 草稿后写入；不实现分镜工作台。

ADR-047：story_assets 汇总当前剧本的直接素材引用和人物图集，兼容 upload_files/assets，不复制对象。跨模块只读投影经 Port，删除检查全部有效引用并遵循存储策略。首期文档开放 PDF/TXT/Markdown，分镜仅保留分类。

ADR-048：用户授权 production 剧本视频工作台。版本化制作快照与原剧情分离，分镜人工确认后复用生成任务；导出复用 editor/FFmpeg。模型能力以已接入适配器与服务端配置交集为准。

ADR-049：V2 本轮实施 Phase 1–4：剧本内章节范围向导、目标时长、带原文来源的规划和分镜工作区。智能/专业共享数据；Agent 自动执行、Credits、多模型覆盖和多轨后期另分阶段，尚未提供的能力不展示为已实现。

### 故事内视频生成 V3

依据 [ADR-050](docs/adr/050-story-video-flow.md)，对外将剧本创作容器称为故事。视频制作入口、草稿与成片归属于故事；旧制作链接按已存 story_id 映射。六步向导复用 Production 和既有异步媒体服务，执行请求在明确确认后提交，不能伪造音频能力或计费数据。

视频制作主流程当前不启用点数、估价和费用确认门槛，按 [ADR-052](docs/adr/052-defer-production-billing.md) 执行；保留权限、版本、镜头确认和媒体校验。
