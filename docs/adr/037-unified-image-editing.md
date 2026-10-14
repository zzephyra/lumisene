# ADR-037：统一万相图像编辑模型

Accepted — 2026-10-11，用户明确授权替换扩图模型并统一后续图像编辑模型。

取代 ADR-035 的新任务模型选择。扩图、局部重绘、参考图指令编辑统一解析已登记启用的 wanx2.1-imageedit（image_inpaint 类别）；文生图片和视频生成保留独立配置。多个供应商同时启用时拒绝歧义。

复用图片异步提交、PG 远端任务 ID、Worker 轮询和七牛持久化。扩图使用 expand，四边像素换算为 1 + offset / 原图对应尺寸，每侧范围 1–2。局部重绘使用 description_edit_with_mask，白色可编辑；参考图编辑使用 description_edit。统一适配器不暴露任意 function 透传。

新任务协议 3，旧协议 2 的已提交任务继续原查询路径，禁止重新调用生成。新编辑输出直接存储供应商结果，不做整块原图覆盖。目录列明供应商支持的全部能力，但未接入产品入口的能力不得假装可用。

参考：https://platform.qianwenai.com/docs/developer-guides/image-generation/wan21-image-editing
