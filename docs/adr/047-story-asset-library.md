# ADR-047: 剧本资源库

Accepted — 用户授权资源库、兼容适配、必要迁移及安全删除。

保留 upload_files 与生成 assets 的既有文件真值，使用 source+UUID 作为兼容资源标识，不复制文件、不为每张人物图片创建剧本引用。新增 story_asset_links 仅记录剧本直接引用、显示名称、分类及可选场景。人物图片通过 Characters 只读查询 Port 实时聚合。

StoryAssets Service 依赖 Stories、Storyline、Uploads、Generation 公开服务；批量 SQL 投影通过各模块导出的只读 Port 组合，不直接导入他模块 ORM。聚合与分页在 PostgreSQL 完成。人物图片主图状态仅由 Characters 维护。

生成资产删除沿用现有策略与清理队列，增加剧本引用拦截。上传删除增加人物/剧本封面/资源引用检查和共享文件行锁，沿用配置中的保留/清理策略。删除入口不自动解除其他实体引用；失败保留原引用。上传归属仍是用户级历史模型，合法所有者可将同一上传引用至多个剧本；详情同时返回 upload_id 和可空 asset_id，后续可渐进统一，不伪造 Asset ID。

上传复用已有七牛签名流程，资源关联前额外验证受控对象的文件头。图片缩略图由现有对象存储读取及 Pillow 缩放，限量内存缓存仅作派生缓存；视频列表不加载原视频。文档 V1 为 PDF/TXT/Markdown，文本安全纯文本预览、PDF下载，不宣称解析全部文件。
