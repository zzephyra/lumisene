# ADR-018: 模型目录与平台管理员控制面

## Status

Accepted — 2026-09-27。用户已确认。

[ADR-028](028-restore-disabled-model-configs.md) 修正下文「只能停用」：已发布内容仍然不可改，`enabled` 可以重新打开。停用时清除的业务指定不会随恢复自动回来。

## Context

[ADR-008](008-model-gateway-langchain-boundary.md) 规定模型调用只经过 Model Gateway。`model_configs` 是全局配置，不是项目资源。密钥明文只在服务端，接口不得返回。版本不可改写，只能停用。见 [数据与事务](../specs/data-and-transactions.md)。

[ADR-013](013-project-membership-roles.md) 规定项目内只有 OWNER 和 MEMBER。系统模型配置目前是受控管理命令，项目角色都不能做。见 [API 与权限](../specs/api-and-access.md)。把“管理员”做成第三种项目角色，或只在前端隐藏按钮，都不能保证普通用户改不了全局模型。

## Decision

采用以下边界。平台管理员不是项目角色，不引入 RBAC。

- `users` 增加仅由管理员命令设置的 `platform_admin`。项目 OWNER 不会因此成为平台管理员。接口不能修改这个标记。
- 项目成员只读 `GET /api/v1/projects/{project_id}/models`。先按现有规则确认成员，非成员 404。响应只含已启用配置的 id、provider、model_name、capability、config_version、parameters_schema、limits。不含 secret_ref、密钥、未启用配置。
- 管理接口挂在 `/api/v1/admin/model-configs`，与项目路由分开。每次请求用当前会话到 PostgreSQL 重查 `platform_admin`。非管理员返回 404，不使用 403，避免暴露管理面。变更请求继续校验 Origin 与 CSRF。
- 创建只接受 provider、model_name、capability、parameters_schema、limits、secret_ref。secret_ref 必须是服务端已配置的密钥名称，请求体不得携带密钥明文。服务端为同一 provider、model_name、capability 分配递增的 config_version。已发布版本不可修改内容，只能停用。停用后成员列表立即不再返回。
- capability 使用 text_generation、embedding、text_to_video、image_to_video，并增加 text_to_image，供已有图片生成入口以后接入。本阶段不调用这些能力。
- 管理操作在同一事务写入 model_config_audits，记录操作者、配置 id、版本和动作，不记录密钥或 secret_ref。
- 前端管理页只在服务端确认管理员后渲染。普通用户直接打开该地址得到与未知页面相同的结果。项目工作台不提供模型开关。
- 本决定只建立目录和控制面。真正调用供应商仍必须经过 Gateway、异步任务和显式用户提交，不能由管理页或模型自行发起付费生成。

## Alternatives

- 让项目 OWNER 管理模型。所有者就能改所有项目可见的模型。
- 只在界面上对普通用户隐藏管理入口。接口仍可被直接调用。
- 把供应商密钥交给浏览器保存。密钥会进入前端存储和日志。

## Consequences

架构、API、数据与前端规范按此边界更新。实现只包含目录、审计和管理页。供应商调用仍必须经过 Gateway、异步任务和显式用户提交。
