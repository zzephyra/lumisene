# ADR-028: 停用的模型配置可以恢复

## Status

Accepted — 2026-10-04。用户明确要求停用的模型可以恢复。

## Context

[ADR-018](018-model-admin-control.md) 规定已发布的模型配置不能改内容，并且只能停用。停用会在同一事务清除它当前的业务指定。管理页因此把停用写成不可恢复。

实际使用里，停用经常只是临时下线。重新登记一份内容相同的配置会增加版本，也不能代替把原来的配置重新打开。

## Decision

修正 ADR-018 里「只能停用」这一条。其余边界不变。

- `PATCH /api/v1/admin/model-configs/{id}` 只接受 `{enabled: true}` 或 `{enabled: false}`。provider、model_name、capability、parameters_schema、limits、secret_ref、config_version 仍然不可改。多出来的字段继续拒绝。
- 把已停用配置设为启用，只把 `enabled` 改回 true，并在同一事务写入审计动作 `enabled`。不改已发布内容，也不调用供应商。
- 恢复不会把停用时清除的业务指定加回去。需要继续使用时，由管理员重新指定。
- 请求的启用状态与当前状态相同则返回当前配置，不再写一条审计。
- 恢复后，成员的已启用列表和业务指定的可选列表重新包含该配置。停用后这些列表仍然立即去掉它。

## Consequences

审计动作增加 `enabled`，需要替换 `ck_model_config_audits_action`。API、数据与前端规范按此更新。Model Gateway、项目隔离和已发布内容不可变保持不变。
