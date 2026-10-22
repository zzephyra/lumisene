# ADR-042: 项目剧本

## Status
Accepted — 用户明确要求实现项目内剧本列表与基础管理。

## Decision
新增 stories 模块，保存项目内剧本的名称、介绍、版本和封面引用。它与 characters 模块的 script_documents 不同：后者是分析用的原文文件，不是可编辑的剧本卡片。

封面不复制文件，也不写入 generation 的 assets 表。创建或更新时只接受当前用户已经上传成功的 JPG、PNG 或 WebP，经 Uploads 应用服务校验后保存 cover_upload_id。项目成员读取剧本时只解析这些已关联上传的地址。项目内资源上传契约仍未实现，不借此另建一套存储。

列表按 updated_at、id 倒序分页。可变剧本使用 version，冲突返回 409 并保留客户端草稿。
