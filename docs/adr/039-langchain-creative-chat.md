# ADR-039: LangChain 创意对话与生成意图

## Status
Accepted — 用户要求实现可替换 DeepSeek 对话与图片生成语义识别；延续 ADR-008 的边界。

## Decision
使用官方 langchain-deepseek（及其依赖 langchain-openai）适配器，标准库现有单次文本请求不能提供 LangChain 的消息和结构化输出接口。LangChain 仅在文本适配器内使用。DeepSeek 模型通过既有 text_generation 业务指定配置，后续更换指定不改变会话协议。不自动调用图片生成。

新增 chat 模块，PostgreSQL 保存 conversations 与 chat_turns。对话版本以一条 turn 保存用户消息和助手回复，复用固定 queued/running/succeeded/failed/canceled 状态；这是规范中独立 messages/chat_runs 的最小成对实现，不实现未接入的 RAG、记忆或 SSE。文本 Worker 同时轮询既有单次补全与对话，队列真值仍在 PG。

每会话锁串行提交，一次最多一个活动 turn。请求 UUID 在会话内幂等，同 UUID 不同内容拒绝。模型调用在事务外，超时/进程中断后失败而不静默重发。快照包含最近至多 20 个成功回合，总上下文限 40000 字符，过早内容不自动带入，并在 UI 说明。项目成员可查看共享项目对话；离开项目后不能继续访问。

模型一次返回 reply、intent(chat/image_generation/video_generation/clarification)、generation_prompt，Pydantic 严格校验。区分否定、引用、讨论与真正执行意图。模型只产生提议；图片方案由用户在消息内点击生成，视频方案仍进入生成页确认。

用户后续授权：图片方案可在对话内点击生成并展示结果。复用现有图片生成 Service、Worker 和资产存储；chat_turns 保存任务关联，任务与关联同事务提交，重复点击返回同一任务。视频仍通过生成页。图片编辑进入既有编辑器。

对话使用 LangChain astream 接收模型增量，只解析 reply 文本；Worker 每至多 300ms 保存部分回复，前端每 400ms 读取活动回合并逐步显示。不是 SSE 推送。完整结果校验成功前不展示生成方案；中断保留部分文字，禁止自动重发付费请求。

对话图片交互更新：用户已授权识别图片生成意图后直接生成。Worker 在新回复完成校验时，同事务创建图片任务并关联消息；历史读取不触发生成，失败仅显式重试。文字在图片容器外，生成期间复用动画骨架，工具栏位于回复底部。
