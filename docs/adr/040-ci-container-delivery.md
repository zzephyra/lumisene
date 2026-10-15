# ADR-040: CI 构建镜像，CD 拉取部署

## Status
Accepted — 用户于 2026-10-15 明确要求将镜像构建移入 CI。

## Decision
沿用 Compose 和模块化单体。pytest 成功后在 GitHub Actions 构建后端、前端镜像并推送 GHCR，以完整提交 SHA 标记；API 与 Worker 共用后端镜像。main 发布串行执行，服务器只拉取和启动，不构建。迁移在更新应用前单独执行。

部署覆盖文件移除开发源码挂载，仅挂载服务器配置和日志，保持命名卷。前端增加 Nginx 静态运行阶段：Vite 开发服务器不适合作为打包产物的部署服务器，现有前端依赖不提供该能力；Nginx 同时承接原有同源 API 代理，不增加业务服务或应用依赖。开发 target 保持 Vite。

## Trade-offs
服务器不再需要构建依赖，但仍需连接镜像仓库。有限重试不能解决持续网络故障。初期镜像目标为 linux/amd64；ARM 部署需要扩展构建平台。应用回退不能代替数据库恢复，不自动执行 downgrade。私网、TLS、备份和生产凭据不由镜像流程自动解决。

详细操作与验收见 [运行规范](../specs/operations-and-acceptance.md)。
