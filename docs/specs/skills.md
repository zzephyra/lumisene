# Skill System

后台 Skill 目录保留新增、编辑、激活、停用、软删除和不可变版本历史；正文是数据，不执行任意代码。框架的 Registry、Router、Executor 和 PromptBuilder 保留供后续明确接入的能力使用。

[ADR-035](../adr/035-native-outpainting.md) 已取代 ADR-033/034 的扩图执行方式：专用 image-out-painting 无提示词参数，因此不读取旧扩图 Skill 正文，不执行旧模板或蒙版合成。旧关联仅为历史信息，不再允许新建关联。当前 default_registry 无生产执行技能；不能宣称上传 Skill 即可改变模型行为。

接入新能力必须实现 BaseSkill、集中注册、服务端校验参数并保存任务快照，经现有 Gateway 调用；项目隔离、用户明确提交、幂等和任务事实仍由现有服务负责。不引入并行任务或模型系统。
