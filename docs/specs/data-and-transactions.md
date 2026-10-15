# 数据模型、事务与并发

## 1. 通用约定

业务表使用 UUID 主键、timestamptz 的 created_at/updated_at；可变聚合增加 bigint version（从 1 开始）。项目资源具有非空 project_id。用户、认证会话、系统模型配置和索引维护记录是全局例外。索引维护事件使用单独的系统任务上下文，禁止用伪造 project_id 通过项目授权。

表中的业务枚举使用文本列加 CHECK 约束；枚举值与 API 一致。关系、权限、状态与查询字段必须为显式列；jsonb 只保存参数快照、能力描述和事件载荷，不能代替关系模型。外键默认 RESTRICT，物理清理由拥有模块的清理用例按依赖顺序执行。

所有跨项目资源引用使用 (project_id, resource_id) 复合外键，目标表提供对应 UNIQUE。项目资源查询必须带 project_id；数据库约束兜底，不能代替 Service 授权。首期不依赖 RLS 实现权限；增加 RLS 需要 ADR。

## 2. 表归属与必需字段

除通用字段外，下表字段是最低业务要求。`?` 表示可空；实现迁移时不得自行删去约束。

| 所属模块 / 表 | 必需字段与约束 |
| --- | --- |
| auth.users | email_normalized UNIQUE、password_hash、status(active/disabled)、platform_admin；不存明文密码。platform_admin 默认 false，只由管理员命令写入，接口不能修改 |
| auth.sessions | user_id、token_hash UNIQUE、csrf_token_hash、expires_at、revoked_at?；会话令牌只存哈希 |
| projects.projects | name、kind(personal/standard)、created_by、deleted_at?、version。部分唯一索引保证每个 created_by 至多一个未删除的 personal 空间 |
| projects.project_members | project_id、user_id、role(OWNER/MEMBER)；UNIQUE(project_id,user_id)，每项目恰有一个 OWNER，由事务维护；部分唯一索引确保至多一个 |
| chat.conversations | project_id、title、created_by、deleted_at? |
| chat.messages | project_id、conversation_id、sequence、role(user/assistant)、content、run_id?、completion_status(complete/partial)、deleted_at?；UNIQUE(conversation_id,sequence) |
| chat.chat_runs | project_id、conversation_id、user_message_id、assistant_message_id?、status、actor_id、model_config_id、model_config_version、request_snapshot、context_manifest、error?、lease字段、started_at?、finished_at?；每会话 queued/running 的部分唯一约束 |
| chat.message_citations | project_id、message_id、ordinal、document_id、document_version_id、chunk_id、locator、source_hash；UNIQUE(message_id,ordinal)，删除源后不返回正文 |
| chat.conversation_summaries | project_id、conversation_id、through_sequence、content、template_version、model_version；摘要是可丢弃派生内容，原始消息仍在 PG |
| knowledge.documents | project_id、title、current_version_id?、created_by、deleted_at? |
| knowledge.document_versions | project_id、document_id、version_number、asset_id、content_hash、parser_version、chunker_version、ingestion_status、index_status、index_revision、error?；UNIQUE(document_id,version_number) |
| knowledge.chunks | project_id、document_version_id、ordinal、text、token_count、locator、content_hash；UNIQUE(document_version_id,ordinal)，分块写入完成后不可原地改写 |
| memory.memories | project_id、kind、current_revision_id、created_by、deleted_at?、version |
| memory.memory_revisions | project_id、memory_id、revision_number、content、source_type(manual/message/document)、source_id?、source_version?、confirmed_by、confirmed_at、status(active/superseded/deleted)；UNIQUE(memory_id,revision_number)，每记忆最多一个 active |
| generation.generation_tasks | project_id、actor_id、kind(image/video)、status、model_config_id、config_version、idempotency_key、request_hash、request_snapshot、provider_task_id?、provider、reconciliation_required、phase、progress?、next_poll_at?、error?、lease字段、started_at?、finished_at?。图片使用 queued/running/succeeded/failed/canceled。视频额外使用 submitting 与 cancel_requested；提交结果不明时保持 submitting 并标记 reconciliation_required，不得重发。UNIQUE(project_id,actor_id,idempotency_key) |
| generation.generation_attempts | project_id、task_id、attempt_number、operation(submit/poll/cancel/store)、provider_request_key、outcome、error_type?、usage?、started_at、finished_at?；UNIQUE(task_id,attempt_number) |
| assets.assets | project_id、kind(IMAGE/VIDEO/AUDIO/FILE)、object_key UNIQUE、sha256、mime、size_bytes、width?、height?、duration_ms?、status(uploading/ready/failed/deleted)、storage_provider(s3/qiniu)、bucket、created_by、deleted_at?、deleted_by?、purge_status?(pending/failed/purged) |
| assets.asset_purge_jobs | 一个资产一条清理任务。保存创建时的 deletion_policy 与 settings_revision。status 为 pending、failed、purged |
| infrastructure.settings.system_settings | namespace + key 唯一，value JSONB，schema_version，revision，updated_at，updated_by。本地默认文件只补缺失键 |
| generation.generation_outputs | project_id、task_id、asset_id、ordinal；UNIQUE(task_id,ordinal)，成功任务至少有一个 ready 输出 |
| infrastructure.ai.model_configs | provider、model_name、capability、config_version、parameters_schema、limits、secret_ref、enabled；UNIQUE(provider,model_name,capability,config_version)，已发布内容不可改写，enabled 可以重新打开。capability 为 text_generation、embedding、text_to_video、image_to_video、text_to_image、speech_synthesis、speech_recognition。列表有上限 |
| infrastructure.ai.model_assignments | capability 主键、model_config_id、config_version、updated_by、updated_at。每项能力最多一个已启用且能力相同的模型。停用该配置时同一事务清除；恢复配置不会自动写回 |
| infrastructure.ai.model_config_audits | actor_id、model_config_id、config_version、action(created/disabled/enabled/assigned/unassigned)、created_at；与配置变更同一事务，不记录密钥或 secret_ref |
| infrastructure.ai.text_completions | project_id、actor_id、model_config_id、config_version、prompt(1–10000)、status(queued/running/succeeded/failed/canceled)、content?、error_code?、error_message?。一次显式文本调用，不是对话消息。供应商调用不得包在写入事务内 |
| infrastructure.outbox.outbox_events | event_id、project_id?、aggregate_type、aggregate_id、aggregate_version、event_type、schema_version、payload、created_at；事件事实不可变 |
| infrastructure.outbox.event_deliveries | event_id、consumer、target_generation、status、attempt_count、next_attempt_at、lease字段、last_error?、completed_at?；UNIQUE(event_id,consumer,target_generation) |
| infrastructure.db.request_idempotency | project_id、actor_id、operation、idempotency_key、request_hash、resource_id、response_status、created_at；四字段 UNIQUE(project_id,actor_id,operation,idempotency_key) |
| infrastructure.search.index_builds | logical_index、target_index、state、snapshot_cursor、started_at、validated_at?、cutover_at?、error?；维护重建进度 |

model_configs 由 AI Gateway 的配置 Repository 拥有，业务 Service 通过能力 Port 查询，不引入独立模型业务模块。记忆来源为多态引用：通过来源模块验证归属和存在性，不能声称普通外键已校验多态 source_id。手工创建可以没有来源；从消息/文档创建必须有来源版本。

按实际查询添加组合索引，至少覆盖 (project_id,created_at,id)、各父资源 ID、任务(status,next_poll_at)、delivery(status,next_attempt_at)。禁止无限制的全表业务列表。对象 key 采用 projects/{project_id}/assets/{asset_id}/{opaque_name}，不暴露用户文件名或跨项目复用 key。

## 3. UoW 与跨模块事务

最外层 Application Service 是一次用例的唯一事务所有者。Router/Worker 负责注入 UoW 工厂，不负责 commit。内部模块公开方法显式接收同一个 UoW，只 flush，不 commit、不重新创建 Session；外层失败则一起 rollback。禁止 Session 在并发 coroutine 间共享。

示例：生成结果字节写入对象存储并验证 → Generation Service 开启 UoW → Assets Service.register_ready(uow, ...) → 写 generation_outputs → 任务变 succeeded → 写 Outbox → 外层 commit。任一步失败，所有 PG 写入一起回滚；孤儿对象由对账处理。

网络操作不占用数据库事务：短事务读取并冻结输入/领取租约 → 关闭事务 → 外部调用 → 新短事务验证租约令牌和版本、落结果。不得为了保持同一 UoW 跨越下载、模型调用或 SSE。

并发更新使用 WHERE version = expected_version 并递增版本；影响零行返回冲突或由后台重新读取。成员删除、项目删除与新外部提交共享项目授权检查的锁定协议：在短事务中检查并记录执行授权，提交前再确认；已经发出的网络请求不能承诺撤回，后续仅允许恢复查询、取消和清理。

## 4. 幂等、重试与编辑冲突

生成、聊天消息、上传初始化、文档创建/版本提交使用 Idempotency-Key（1–128 个 ASCII 可打印字符）。唯一约束包含键本身，不能只约束项目/用户/操作。operation 使用稳定语义名，例如 generation.create，资源 ID 是请求哈希的一部分。

哈希覆盖规范化后的业务 DTO、路径资源、选定模型版本；排除 request_id、Cookie、时间与幂等键。首次创建资源、幂等记录和 Outbox 在同一事务提交。并发相同键由唯一约束收敛，重新读取原结果；相同请求返回原状态码/资源 ID，不再提交新任务；不同请求返回 409 idempotency_conflict。重放仍需当前授权，不得复活已删除项目。关联资源已删除时返回 410 resource_gone。

记录在资源保留期内不得清除；物理清理后保留键与哈希墓碑 30 天，并明确幂等重放保证只在该保留窗口内成立。用户主动重试使用新键，并关联 retry_of_task_id。

PATCH 项目、会话、记忆必须携带 expected_version，失配返回 409 version_conflict。任务取消是幂等命令，不要求客户端根据旧状态计算转移。不要用“先查询再插入”代替唯一约束。

## 5. 来源验证与清理

memory 使用 VerifiedSourcePort 验证来源。该 Port 由来源拥有模块提供只读实现，仅返回已授权的来源 ID、项目、版本与哈希；在组合入口注入，memory 不 import chat/knowledge Service，不产生 chat → memory → chat 的递归用例。来源拥有模块的 Repository 仍是唯一查询者。系统模型配置通过只读 capability Port 注入，不引入反向业务依赖。

删除先屏蔽读取；正文/对象物理清理与引用元数据保留分开。被 message_citations 引用的 chunk/document 不能直接删掉导致外键失败：清空可删除正文并保留 ID、hash、locator、deleted_at 墓碑，待引用的保留期结束后按依赖顺序清理。chunks.text 在有效期间非空，清理后允许 NULL，查询必须排除墓碑。记忆修订亦只保留必要元数据，不用修订历史绕过用户删除。

旧版文档更新不会物理清理尚需历史引用的正文；文档显式删除才触发清理。项目删除清理涉及多个模块，由恢复 Worker 调用各模块公开清理用例，业务模块之间不反向 import。全局审计记录由 infrastructure 提供追加写入 Port，至少记录 actor、operation、target、request_id、outcome、created_at，不保存密钥或原文。任务人工恢复必须写审计记录。

## 视频剪辑数据

迁移 0009 增加 editor_documents、editor_renders；编辑工程及不可变导出快照为版本化 JSONB，权限、项目、操作者、版本和任务状态保持显式列。源资产引用通过既有资产用例验证。详见 [视频编辑器](video-editor.md)。

迁移 0010 为工程、渲染任务及资产增加项目复合外键；editor_document_assets 和 editor_render_assets 显式登记源引用，防止跨空间引用及素材被物理误删。

## ADR-024 管理审计

`auth_admin_audits` 归 auth，`generation_admin_audits` 归 generation，包含 id、actor_id、target_id、action、before_status、after_status、request_id 与时间。操作及审计在同一 UoW 提交，失败共同回滚。账号目标行锁与 expected_updated_at 防止覆盖；登录也锁定同一用户行，使停用/会话撤销与新会话创建串行化。任务取消使用同一行锁与既有事务内取消用例，Worker 竞争仍服从原状态条件更新。后台查询直接读取 PG，不使用 ES 判断状态。迁移：0012_admin_operations。

## ADR-025 资产盘点与导出审计

用户上传归 uploads，项目资产归现有 generation 资产用例，渲染与编辑器来源归 editor。EditorAdminService 通过 AssetAdminService 查询安全资产 DTO 后以自身渲染记录补全来源，不由跨模块 SQL JOIN 读取素材表。生成来源从 GenerationOutput 判断，未确认来源标记 other，不从对象键猜测。

editor_admin_audits 与导出取消状态在同一事务提交。取消通过与 Worker 领取相同的 EditorRender 行锁串行化；running 不可取消。迁移 0013 添加审计表与三个管理列表时间/ID 索引。对象存储、现有源引用和项目成员权限保持原语义。


### 生成输入（ADR-026）

`generation_inputs` 归 generation 所有，记录项目、创建人、图片/蒙版私有对象键、SHA256、尺寸及上传状态。独立于作品 Asset。先提交 uploading 登记，事务外写对象，再提交 ready；失败登记保留供重试/回收。请求失败不会留下无归属的新对象键。任务增加可空 input_id，与 project_id 建立复合外键；旧任务为空。任务快照保存 operation，模型配置版本与内容摘要进入已有不可变任务/幂等契约。图片重绘合成阶段保留蒙版外原图像素，结果另存资产。

输入读取/绑定与回收使用行锁。回收先确认无任务引用，再标记 deleted 并提交；新任务只允许 ready 输入，防止提交后回收其依赖。所有任务引用（包括终态）都阻止回收。

创作技能运行绑定：creative_skills.runtime_key 与 creative_skill_revisions.runtime_key 归现有 AI 目录。迁移 0017 增加未删除 runtime_key 非空的唯一部分索引；不存在关联时使用 Git 默认，不强制初始化技能行。任务快照在既有 GenerationTask 提交事务中固化，Worker 不跨模块读技能表。

### 创意对话首版实体
ADR-039 使用 chat_conversations 与 chat_turns，后者成对保存 prompt/reply、结构化 intent、模型配置快照和上下文快照。会话项目复合外键、会话内 request_id 唯一、活动回合部分唯一索引。历史只选成功回合，数据库为真值。

对话图片关联：chat_turns.generation_task_id 可空，外键关联 generation_tasks。提交时锁定项目内消息，图片任务和消息关联在同一 UoW 提交，避免重复点击创建多份作品。
