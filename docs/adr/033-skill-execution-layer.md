# ADR-033: 统一 Skill 执行层

## Status
Accepted — 2026-10-07。用户明确要求本次架构升级并实现扩图迁移。

## Decision
- 在现有 AI 基础设施内将 skills.py 升级为 skills 包，原目录管理代码迁入 catalogue.py，保持现有导入兼容。
- Skill 是产品能力，Provider 是协议适配。Router 确定性映射操作，Registry 中央注册版本，Executor 负责校验、可选场景上下文、PromptBuilder、适配器执行和安全日志。
- 第一阶段完整迁移 image.outpainting；image.inpainting、video.image_to_video 只预留确定性路由，未实现执行时明确拒绝，不伪装可用。既有其他操作保持原链路。
- Git 中 config.yaml、prompt.md 和 refine.md 是默认能力定义，不依赖数据库存在 Prompt。已存在的创作目录可通过 runtime_key 唯一关联能力；未关联继续作为目录内容。关联后 enabled 控制新任务准入，content 是基础模板之外的管理员补充指令；禁用后新任务拒绝，删除后解除绑定并回退 Git 默认，UI 明示。
- 不另建模型指定体系：使用统一图片模型及已有 Provider 适配器，supported_models 可限制允许模型，model_overrides 只追加模型指令、不切换供应商。
- 任务提交同事务写 skill 快照，含技能/Prompt 版本、模板、补充指令、选中模型。Worker 不读取后续目录编辑；已排队任务照快照执行。历史无快照扩图任务使用兼容 Git 默认，不追溯新增绑定。
- 输入图片、蒙版、项目归属、任务状态机、存储流程保持现有行为。纯图像处理移入 AI 图像工具，生成模块保留兼容导出；Skill 不访问项目业务表。
- 不调用 LLM 路由、不添加 Agent、DAG、脚本执行、插件市场或新依赖。Scene Analysis 是可选端口，无实现不发起分析调用，失败仅记录类型并退化。
- 日志只记录 task trace、skill/version、model/provider、latency、success、错误类型；不输出 Prompt、图片、凭据或供应商原始错误。
- 本决策扩展 ADR-032 的目录管理范围；不改变 ADR-027 统一模型规则。
