# ADR-050：故事工作区与六步视频生成流程

## Status
Accepted — 用户明确要求 V3 产品与架构重构，覆盖 V2 的导航与创建流程。

## Existing capabilities
复用 stories / storyline / characters / story_assets 与 productions；生产任务已有 story_id，历史数据无需推测归属。复用文本 Worker、模型 Gateway、媒体生成任务、视频编辑工程与异步导出。当前没有有效 Credits 报价/余额和独立语音、音乐、字幕供应商，不提供伪造配置。

## Decision
UI 统一使用“故事”，不重命名数据库表和稳定接口。移除全局制作导航；新增故事内 productions 路由和成片页。旧项目级制作链接读取真实归属后重定向，无法读取时显示错误，不删除数据。

六步向导使用同一 Production 数据：选择剧情、规格、人物场景、声音风格、分镜规划、确认生成。草稿配置存入现有 JSONB；异步规划预览须明确采用。付费媒体任务仅在最终确认后触发，报价未知必须显式知悉；不伪造预算约束。

故事级 API 校验路径 story_id 与 Production 归属。后台执行使用 production_runs 的 execution 类型编排现有媒体任务，不新增队列或任务状态。执行期间锁定制作输入，稳定幂等键关联镜头任务，失败保留结果；恢复不重复生成已完成镜头。独立音轨和自动音频生成待供应商与编辑契约补齐。

## Runtime verification and compatibility

- 已配置图生视频模型而无首帧时，execution 先提交现有 image task，成功采用后才提交 video task；每阶段使用稳定幂等键。禁止把只支持图生视频的模型当作文生视频。
- 中国区 `.maas.aliyuncs.com` 对旧 `wan2.1-i2v-turbo/plus` 的线协议标识为 `wanx2.1-i2v-turbo/plus`，适配器按区域做同型号名称转换，不进行跨模型回退。依据：[阿里云首帧视频 API](https://help.aliyun.com/en/model-studio/legacy-image-to-video-api-reference/)。
- 对白数组仅做字符串表示归一化。旧规划缺失来源时，仅能通过选中原文中唯一的字面引用恢复 UUID；歧义、错误来源和媒体注入仍拒绝。
- 开发环境挂载源码不代表已有 Python Worker 会自动加载修改。修改 Worker/Service 后须在无活动提交时重载相关 Worker。生产部署依靠相同 commit 镜像更新 API 和全部 Worker，不只更新前端/API。
- collector 独立捕获并记录异常，单个规划模块失败不能阻断视频制作调度。成片 UI 显示实际规划/首帧/镜头/导出阶段；保留失败历史，但不把旧失败提示显示为当前执行错误。
