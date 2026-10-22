# ADR-041: 剧本人物知识图谱

## Status
Accepted — 用户明确授权从调研、架构设计到 MVP 实现。

## Decision
新增项目级 characters 模块，管理人物、关系、文档、片段、证据、分析任务与布局。PostgreSQL 保存业务事实，沿用对象存储、项目授权和文本模型能力指定，不引入新图数据库或第二队列。LangChain 只用于文本适配器。新增统一 Parser 是现有规范的首次实现，不建立平行解析路径。

采用 React Flow 和 d3-force：现有 UI 依赖不提供图连接、视口管理和力导向布局，避免重复建设。PDF 提取需要专门库，标准库无法可靠解码 PDF 字体；DOCX 复用标准 ZIP/XML 且限制解压大小。

允许人物属性使用严格 Schema、schema_version 版本化 JSONB；项目、关系端点、权限和任务状态仍为显式字段及约束。AI 产物先审核，不覆盖用户事实；所有证据校验原文。任务复用现有 Worker 进程模式，状态为 queued/running/succeeded/failed/canceled。

完整设计及实现步骤见 [设计规范](../specs/character-graph.md)。
