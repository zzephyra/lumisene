# Architecture Decision Records

已确认的决策。变更这些决定时先新增 ADR，再改 `ARCHITECTURE.md`。

| ADR | 标题 | 状态 |
| --- | --- | --- |
| [001](001-modular-monolith.md) | 模块化单体与模块边界 | Accepted |
| [002](002-postgresql-source-of-truth.md) | PostgreSQL 为唯一业务事实源 | Accepted |
| [003](003-elasticsearch-search-index.md) | Elasticsearch 只做可重建检索索引 | Accepted |
| [004](004-pg-es-transactional-outbox.md) | PostgreSQL 到 Elasticsearch 的事务性 Outbox | Accepted |
| [005](005-celery-redis-workers.md) | Celery、Redis 与 Worker | Accepted |
| [006](006-s3-object-storage.md) | S3 兼容对象存储 | Accepted |
| [007](007-cookie-session-auth.md) | Cookie 会话认证 | Accepted |
| [008](008-model-gateway-langchain-boundary.md) | Model Gateway 与 LangChain 边界 | Accepted |
| [009](009-task-state-machine.md) | 统一任务状态机 | Accepted |
| [010](010-billing-deferred.md) | 首期不做计费账本 | Accepted |
| [011](011-video-status-sync.md) | 视频状态同步 | Accepted |
| [012](012-document-parser.md) | 知识库文档解析 | Accepted |
| [013](013-project-membership-roles.md) | 项目成员角色 | Accepted |
| [014](014-executable-contracts.md) | 可执行契约与恢复边界 | Accepted |

| [015](015-marketing-landing.md) | 独立官网展示层与品牌主题 | Accepted |
| [016](016-oauth-github-google.md) | GitHub 与 Google 登录 | Proposed |
| [017](017-workspace-navigation.md) | 三入口项目工作区 | Accepted |
| [018](018-model-admin-control.md) | 模型目录与平台管理员控制面 | Accepted |
| [019](019-business-model-assignment.md) | 业务模型指定 | Accepted |
| [020](020-text-to-video.md) | 文生视频接入 | Accepted |
| [021](021-personal-creative-space.md) | 登录后进入个人创作空间 | Accepted |
| [022](022-video-timeline-editor.md) | 项目内视频时间线编辑器 | Accepted |
| [023](023-qiniu-direct-upload.md) | 用户素材直传七牛云 | Accepted |
| [024](024-admin-users-generation.md) | 用户管理与生成任务运营后台 | Accepted |
| [025](025-admin-assets-exports.md) | 资产与视频导出运营后台 | Accepted |
| [026](026-image-inpaint-and-image-to-video.md) | 图片局部重绘与图生视频 | Accepted |

| [027](027-unified-media-models.md) | 按媒体类型统一模型指定 | Accepted |
| [028](028-restore-disabled-model-configs.md) | 停用的模型配置可以恢复 | Accepted |
| [029](029-model-endpoints-yaml.md) | 模型密钥用 YAML 文件配置 | Accepted |
| [030](030-provider-catalog-yaml.md) | 供应商目录写在模型端点 YAML | Accepted |
| [031](031-wan3-first-frame.md) | wan3.0-video 用首帧媒体生成视频 | Accepted |

| [032](032-admin-skills.md) | 创作技能目录管理 | Accepted |
| [033](033-skill-execution-layer.md) | 统一 Skill 执行层与扩图迁移 | Accepted |

- [034：结构化扩图流水线](034-structured-outpainting.md)

- [035：专用原生扩图模型](035-native-outpainting.md)（取代 034）

| [036](036-qiniu-generated-assets.md) | 生成作品写入七牛，删除策略做成系统设置 | Accepted |
- [037：统一万相图像编辑模型](037-unified-image-editing.md)

- [038 — 公开作品与个人主页](038-public-works.md)

- [039 — LangChain 创意对话](039-langchain-creative-chat.md)
