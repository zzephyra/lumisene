# ADR-046: 剧情章节与场景创作

## Status
Accepted — 用户明确授权剧情 V1 数据、接口、编辑器及异步 AI 实现。

## Decision
新增 storyline 业务模块，依赖 Stories、Characters 的公开 Service，不直接查询它们的表。章节与场景独立持久化，场景正文保存带 schema_version 的 JSONB 块；人物 UUID 引用在写入时验证，删除人物不级联删除正文，读取时显示失效引用。

项目与剧本复合外键隔离所有数据；章节集合锁及版本保护排序，场景自身版本保护编辑。外层 Service 拥有事务。AI 复用 TextCompletionService、现有模型指定和 text_worker，关联提交同事务，结构化输出校验失败最多修复一次。待确认结果与正式剧情分离，追加/局部应用显式提交并校验版本；不新增队列或网关。Worker 中断的文本请求标记失败，用户显式重试，不自动重复付费调用。

前端只替换剧情 Tab，复用 UI、TanStack Query 和 API 客户端。编辑器串行 debounce 保存，保留失败草稿、离开确认和刷新提示；AI 应用使用提交时版本避免覆盖人工修改。V1 整篇生成支持大纲及场景结构，详细正文由场景辅助分段生成。
