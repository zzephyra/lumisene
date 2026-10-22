# 剧情创作 V1

对应 [ADR-046](../adr/046-storyline-authoring.md)。仅替换剧本详情剧情 Tab，不改变顶部导航。

## 数据与接口

迁移 `0028_storyline` 新增 plot_states（章节集合版本）、plot_chapters、plot_scenes、plot_jobs。所有实体通过复合外键绑定 project/story，章节删除级联其场景。场景保存 schema_version=1、action/dialogue/narration 正文块及人物 UUID 数组；人物删除不级联正文。新人物引用必须属于当前剧本，既有失效引用允许原样保留。

前缀 `/api/v1/projects/{project_id}/stories/{story_id}/plot`：
- GET/POST chapters；GET/PATCH/DELETE chapters/{id}。
- PUT chapters/order（完整 ID 集合及 expected_version）。
- GET/POST chapters/{id}/scenes；PUT chapters/{id}/scenes/order。
- GET/PATCH/DELETE scenes/{id}（正文、人物与元信息同版本保存）。
- GET/POST jobs；POST jobs/{id}/apply；DELETE jobs/{id}（放弃预览，不声称能中断供应商正在执行的请求）。

写入先授权再取得剧本级事务 advisory lock；章节集合版本及每章场景集合版本防止排序覆盖；正文 expected_version 冲突返回409，不静默覆盖。AI 幂等键含项目、剧本和调用者，提交与关联在同一事务。

## 前端

StorylinePage 提供响应式章节网格及纵向场景列表。仅拖动手柄启动排序，更多菜单提供上移/下移。删除使用 Dialog，明确删除子场景。SceneEditor 提供块类型切换、对白人物、块排序、出场人物搜索、场景属性及局部 AI。

useSceneDraft 在800ms后串行自动保存；连续输入等待前一请求版本确认后再发送。失败保留草稿和重试，不展示假成功。当前浏览器 sessionStorage 保存未完成草稿，离开链接和浏览器刷新给出未保存提示。版本过期的恢复草稿仍按旧版本提交并显示冲突，不覆盖服务端新版本。草稿存储不是服务端事实源，清除浏览器数据会失去未保存草稿。

## AI 与范围

复用已指定的 text_generation、TextCompletionService 与 text_worker。整篇生成支持1–10章、大纲或章节/场景结构；详细内容通过场景续写、润色、动作、对白、选中块重写分段生成。

上下文包含真实剧本名称/介绍、已有章节摘要、人物属性/关系及局部场景，数量与输入长度有界。当前 Story 没有独立类型/风格字段，不伪造字段；用户可明确填写本次风格。返回内容经过严格 Pydantic 校验及角色引用检查，非法结构最多一次重新生成修复。预览可编辑章节与场景标题/简介及正文块，确认时重新校验。追加不删除已有章节；局部应用按生成时场景版本校验，人工修改后必须重新生成。

任务状态、预览、是否已应用持久化；关闭弹窗或重新进入可从 AI 创作记录恢复。确认应用幂等。超过15分钟仍无文本结果时标为失败供显式重试，不自动重发结果不明请求。

## 运行与验证

更新需要 `alembic upgrade head` 并重新加载 API、重启 text-worker。本地已应用迁移；生产环境由部署流程执行。自动测试使用明确标识的测试模型，覆盖持久化/隔离/版本冲突/删除/AI预览确认/一次结构修复/人工冲突与前端串行保存。真实模型内容质量、超长剧本、浏览器触控排序仍需实际场景验收。

V1 不新增分镜表，不做全剧一次性详细生成。每章/场景集合最多300项；AI 上下文取最多30个人物及40条关系并按总长度进一步裁剪。后续可增加章节级语义检索、长篇分阶段生成、专门的冲突对比界面。
