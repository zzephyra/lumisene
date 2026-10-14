# ADR-036: 生成作品写入七牛，删除策略做成系统设置

## Status

Accepted — 2026-10-10。用户要求生成作品持久化到七牛，并提供可立即生效的删除策略。

## Context

[ADR-006](006-s3-object-storage.md) 把生成字节放在 S3 兼容存储。开发环境因此使用 MinIO。[ADR-023](023-qiniu-direct-upload.md) 只把用户直传接到七牛，并明确不改生成结果的写入路径。作品的长期地址如果留在应用容器或供应商临时 URL 上，进程重启后就不能再访问。

删除作品需要区分“业务上不再展示”和“是否同时删除云端文件”。这个选择必须可在后台修改，重启不得覆盖管理员已经保存的值。

## Decision

- 配置了七牛时，图片生成、参考图生成、局部重绘、扩图、图生视频和编辑器导出的结果字节，经现有 `QiniuStorageProvider` 写入七牛。未配置七牛时仍使用 ADR-006 的 S3 兼容存储，并在资产上记录 `storage_provider`，避免把两套存储伪装成同一种。
- PostgreSQL 保存 `object_key`、bucket、校验和、媒体类型、大小、尺寸和时长。签名 URL 只在项目授权后短期签发，不作为永久地址。
- 对象 key 使用 `projects/{project_id}/assets/{task_id}/{ordinal}.{ext}`。上传成功后先把 key 与校验值写入任务快照并标记 `persisting`，再登记资产。进程重启后只完成登记，不再次调用生成模型。同一任务和序号的唯一约束防止重复资产。
- 上传成功但资产事务失败时，对象留在确定性 key 上，由同一次恢复登记复用，不另传一份。
- 作品删除始终软删除并记录 `deleted_at`、`deleted_by`。是否删除云端文件由系统设置 `assets.deletion_policy` 决定：`retain_cloud_file` 不调用删除；`delete_cloud_file` 在同一 PostgreSQL 事务写入清理任务。任务快照保存当时的策略和 revision，之后修改设置不改变已排队任务。
- 清理由 Worker 执行。七牛返回文件不存在视为成功。仍被其他未删除资产或编辑器引用的对象不删除。
- 系统设置保存在 PostgreSQL。`config/system-defaults.json` 只在对应 schema 版本首次初始化和补充缺失键时使用。Redis 只缓存带 revision 的设置副本；写入失败不回滚已提交的设置，并由 publication 记录重试。影响删除的读取在删除事务内直接读 PostgreSQL。

## Consequences

作品文件不再依赖应用服务器本地磁盘，但仍依赖 PostgreSQL 元数据和七牛对象的持久化与备份。七牛未配置时，新的生成结果继续落在 S3 兼容存储，迁移任务不得把读不到的旧文件记为已迁移。

## Migration

Alembic `0018_asset_storage_settings` 增加资产存储字段、清理任务和系统设置表。已有行的 `storage_provider` 默认为 `s3`。
