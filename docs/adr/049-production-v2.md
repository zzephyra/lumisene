# ADR-049：剧本驱动的视频制作 V2

## Status
Accepted — 用户明确授权产品与架构重构，并允许优先完成 Phase 1–4。

## Audit
V1 已有 productions（剧本关联、不可变源快照、版本化 JSONB 分镜）、production_runs（复用文本/媒体/导出任务）、production_assets（引用保护）；剧情章节和场景、人物图谱/图集、模型目录、FFmpeg 编辑工程均可复用。V1 尚缺章节选择、全局制作设置、源更新差异、带来源的改编计划和真正的卡片分镜视图。

## Decision
本轮完成 Phase 1–4。增加 productions.settings JSONB，旧数据以默认设置兼容；不重复创建 Script/Chapter/Shot 表。章节选择按用户顺序写入本次快照，保留原章节/场景 UUID 与版本。修改设置和同步源采用 production.version 乐观锁。同步必须提供当前差异指纹，保留镜头与生成历史，提示来源过期。

Production Plan 增加改编摘要、风险、镜头原文定位、重要性和建议生成时长。时长预算由确定性加权算法分配，结合对白长度和剧情重要性；建议生成时长取已接入模型能力。无法满足目标时明确风险，不伪造音频长度、价格或内容质量评估。

复用同一分镜模型承载智能/专业模式；本轮智能模式仅提供引导规划与人工确认，自动执行、Director 工具、成本审批、多模型覆盖和多轨音频/字幕属于后续阶段。没有价格配置时显示无法预估，不启用最大 Credits 等无法执行的限制。不得绕过现有统一指定模型边界。

## Follow-up
Phase 5：有效价格配置、预算审批、单镜头模型路由与真实供应商验证。
Phase 6：受控 Director 修改计划、确认和有限重试。
Phase 7：映射真实 Production Plan 的 React Flow 节点工作区。
Phase 8：扩展编辑工程契约，统一预览和 FFmpeg 的音频、字幕、转场与裁剪语义。
