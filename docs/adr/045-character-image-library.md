# ADR-045: 人物多图与生成任务关联

Accepted — 用户明确授权人物形象系统、持久化结构与 AI 生成闭环。

characters 模块新增 character_images 和 character_image_jobs。图片引用已存在的上传或生成资产，不复制媒体；项目/剧本/人物复合外键确保归属。通过人物行锁串行化图片写入，部分唯一索引确保最多一张主图；图片独立写入不增加文本版本。旧 avatar_upload_id 迁移为主图并保留兼容字段，但文本更新不再改动图集。

AI 任务复用 ImageGenerationService（commit=False）并与人物任务关联同事务提交，现有图片 Worker 调用人物服务收集完成结果，关闭页面也不影响执行。所有图像生成仍经既有 Gateway。参考图使用受权媒体的对象键读取并复用 GenerationInputService；不接受任意远程 URL。新增图片仅解除关联，不删除底层上传或作品；生成作品删除前调用人物引用查询接口，拒绝删除仍被人物使用的资产。

前端 TanStack Query 缓存以项目、剧本、人物隔离；图片操作不覆盖文本草稿。任务状态来自后端，不显示虚构进度。
