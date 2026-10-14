# ADR-032: 后台技能目录管理

## Status

Accepted — 2026-10-07。用户确认按创作技能目录实现并扩展管理员权限。

## Context

当前项目没有 Skill 数据模型或执行模块。ARCHITECTURE.md 的平台管理员权限仅覆盖已列出的管理用途，新增技能目录写入须明确权限与内容边界。

## Decision

- 新增后台入口 `/admin/skills`，沿用现有后台视觉、表格、搜索、分页和确认交互。
- 首版管理技能定义，不自动安装依赖、执行上传脚本或触发模型调用。内容类型为创作提示词或 Markdown 技能说明；可执行包需要独立评审执行边界。
- 字段：id、唯一 slug、名称、简介、Markdown 正文、版本、enabled、created_by、updated_by、created_at、updated_at、deleted_at。
- 管理动作：新建、查看详情、编辑、新建版本、激活、停用、删除。新建默认停用。删除为软删除并同时停用；保留已有历史引用，不允许普通查询返回已删除项。
- PostgreSQL 是唯一事实源，带 Alembic 迁移；本期无需 Elasticsearch、队列或额外基础设施。
- 定义归现有 AI 基础设施目录，HTTP 路由沿用现有 API 层；不创建平行认证体系。后续业务若实际调用技能，应通过目录服务读取已启用版本，并持久化调用时版本快照。此轮不默认改变现有生成系统提示词。
- 所有管理接口验证有效账号及 platform_admin；非管理员返回 404。写操作沿用 CSRF/Origin 校验。
- 版本条件更新，冲突返回 409；业务变更与技能审计同事务提交。版本记录保存不可变正文与动作、操作者、技能 ID、版本和时间；同一记录提供变更审计，不把正文写入日志。
- API：GET/POST `/api/v1/admin/skills`，GET/PATCH/DELETE `/api/v1/admin/skills/{id}`；PATCH 可更新内容或 enabled，必须携带 expected_version。
- Markdown 作为内容保存与展示，不执行其中指令；预览禁止原始 HTML 注入。限制名称、slug、正文长度并做服务端验证。
- 前端使用 TanStack Query 与生成 OpenAPI 类型；完成后验证管理员/非管理员、CSRF、分页搜索、唯一 slug、状态切换、软删除、并发冲突、审计及刷新持久化。

## Scope

本期完成目录管理；激活不代表自动加入对话或生成提示词。不执行 Markdown 中的指令、脚本或依赖安装。

后继决策：[ADR-033](033-skill-execution-layer.md) 允许将目录项关联到 image.outpainting，并将已启用内容作为新任务的技能补充指令；未关联条目保持目录用途。
