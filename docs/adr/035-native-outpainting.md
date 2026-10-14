# ADR-035: 专用异步扩图模型

Superseded for new tasks by ADR-037 — 2026-10-10，用户明确要求清除旧扩图逻辑并改用 image-out-painting。

取代 ADR-034 的执行流程及 ADR-027 的扩图模型统一要求。扩图只解析已登记、启用的 image-out-painting 配置（image_inpaint 类别），多个供应商同时启用时拒绝歧义。普通图片生成与局部重绘保持原指定。

原图与四边像素参数 → 原生异步 out-painting 接口 → 持久化远端 task_id → Worker 短轮询 → 完整结果私有资产。不存在提示词、分类、蒙版、拼接或第二次生成。比例选择在前端转换为四边像素，避免 API 参数优先级冲突。

复用图片 queued/running/succeeded/failed 状态。调用意图先记录 running；提交不明保留 running + reconciliation_required，禁止重新提交。已取得远端 ID 的任务重启后继续查询。私有调试包仅保存源图、请求参数、原始结果，不记录密钥。

旧扩图 Skill 实现与规划 API 移除；Skill 管理目录和历史版本保留，历史扩图绑定不再执行，后台不可新增该绑定。在途旧任务明确失败并要求重新提交，不迁移为另一付费请求。
