# 实现规范索引

这些文档是 ARCHITECTURE.md 的规范性细则，不是已经实现的功能说明。更新日期：2026-09-28。

| 文档 | 唯一维护的细节 |
| --- | --- |
| [数据与事务](data-and-transactions.md) | 表归属、约束、UoW、并发与幂等 |
| [任务与同步](tasks-and-events.md) | 状态转移、租约、Outbox、索引重建 |
| [API 与权限](api-and-access.md) | DTO、路由、错误、认证、成员权限、SSE |
| [RAG 与记忆](rag-and-memory.md) | 入库、召回、上下文、引用和记忆生命周期 |
| [视频编辑器](video-editor.md) | 帧契约、工程保存、异步导出与验收 |
| [前端规范](frontend.md) | 页面、组件、视觉 token、交互与缓存 |
| [运行与验收](operations-and-acceptance.md) | 默认限制、恢复、测试门槛、当前实现缺口 |

总架构维护边界和原则；本目录维护可执行契约；ADR 维护决策及理由。不要复制完整规则到多份文件。冲突必须修正文档后再实现，不允许靠文件新旧或命名大小写猜测优先级。既有 ADR 的明确修订以其后继 ADR 为准。

实现一个功能前至少阅读其 API、数据约束、状态机和验收项。供应商参数由能力配置决定；本规范中的操作默认值可以通过集中配置调整，但不能绕过硬性安全边界。

品牌展示与兼容性规则见 [Lumi 品牌规范](branding.md)。

Skill 运行时、后台关联和扩展方式见 [Skill System](skills.md)。

- [扩图结构化重构与验收](outpainting-acceptance.md)
