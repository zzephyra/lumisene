# 当前版本：ADR-037

新扩图使用 wanx2.1-imageedit / expand。旧 image-out-painting 以下说明仅用于协议 2 历史任务恢复。每侧 scale=1+offset/对应尺寸，范围 1–2；新模型不发送 best_quality、limit_image_size。扩图工具栏允许用户输入最多 800 字符的扩展内容，默认沿用当前作品提示词；两者均为空时使用保持原图主体、构图、风格、光线和颜色连续的保守描述。该描述进入幂等摘要并作为供应商 `input.prompt` 提交。局部重绘和参考图指令编辑共用该模型，单次一张，输入宽高 512–4096。

# 原生扩图与验收

当前执行规范以 [ADR-035](../adr/035-native-outpainting.md) 为准，取代 ADR-034。

## 使用与配置

后台登记并启用模型 `image-out-painting`，类别 `image_inpaint`（专用工具例外），服务端目录配置提供 endpoint 与密钥引用。仅允许一个供应商处于启用状态；同供应商采用最新启用配置。无需更换统一图片生成模型。缺少配置时扩图入口显示原因，不回退普通图片模型。

图片编辑器选择扩图方向或比例、拖动边框、选择最佳质量，确认后提交。比例在前端换算为四边像素，只发送一种扩展参数，避免供应商优先级覆盖。没有提示词、新增主体分类、蒙版、背景复制、颜色校正或原图覆盖合成。

小图等比放大至短边至少 512，四边像素同步换算；原图长边不得超过 4096，PNG 不超过 10MB。横向/纵向新增量分别严格小于原尺寸三倍，目标比例在 1:4–4:1，本地画布仍限制单边8000、1600万像素。不能满足时显示错误而非静默裁切。

## 协议

`parameters.outpaint` 接受 `left_offset/right_offset/top_offset/bottom_offset` 非负整数及 `best_quality` 布尔值。后端强制 `limit_image_size=true`。私有输入仅保存原图，无 mask。模型按原生 `input.image_url` Base64 形式接收图片。

POST `/api/v1/services/aigc/image2image/out-painting`，带 `X-DashScope-Async: enable`，固定模型名。仅提交一次；返回 task_id 写 PostgreSQL。Worker 查询 `/api/v1/tasks/{id}`，成功后下载 `output_image_url`，验证图片字节后直接入库为完整作品。不对结果重绘、合成或再次调用模型。

短轮询使用现有 next_poll_at、lease_token、lease_expires_at；数据库重启/Worker重启后继续查询。超时/结果不明禁止重新提交，标记 reconciliation_required，需管理员查供应商记录。任务查询失败不等于生成失败，继续有限期查询；24小时后转人工核对。旧协议排队任务明确失败，不自动换模型产生费用。

旧 outpaint-plan 已删除。调试包保留原图与请求参数，成品即模型原始图片，可从生成资产下载；历史调试包继续按项目鉴权读取。Skill 目录记录与历史版本保留，但旧扩图关联不再执行，禁止新增该关联。

## 验证范围

自动测试覆盖专用模型解析、禁止回退、请求字段无prompt/mask、尺寸限制、单次提交、幂等、进程恢复轮询、提交不明不重发、结果原样保存，以及前端重复点击与源图切换。

真实供应商支持情况及视觉质量必须单独验收，替身测试不能证明无接缝。本次未发送收费生成请求。

参考：[用户提供的接口指南](https://platform.qianwenai.com/docs/developer-guides/image-generation/image-out-painting)、[原生参数参考](https://help.aliyun.com/zh/model-studio/image-scaling-api)。
