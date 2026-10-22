# 剧本人物知识图谱设计

状态：实施设计，验收状态以测试和交付报告为准。对应 ADR-041。

## 产品与范围
人物图谱位于剧本详情的「人物关系」标签内，不作为项目侧栏入口，打开剧本时也不直接进入图谱。同一项目的不同剧本各自拥有人物、关系和布局。桌面为工具栏和可缩放画布。点击人物或关系后，右侧 360px 详情以抽屉盖在画布上，不改变画布尺寸和视口。节点是约 260px 的横向卡片，显示头像或姓名首字、姓名，以及已填写的年龄、身份、Title、角色定位和一句简介；空白字段不显示占位文案。人物详情通过独立 API 读取。图谱列表额外返回已有的 age、occupation 和从档案摘出的 summary，不新增数据库字段。空白点击和拖动不关闭侧栏，切换对象保留同一侧栏。未保存内容切换前确认；版本冲突保留草稿，提示重新加载。

MVP 提供人物/关系编辑、布局持久化、文件解析、异步分析和证据审核。高级阵营、实时协作、历史图谱版本、人物图像生成不属于首期。

## 技术调研与分工
React Flow @xyflow/react 使用 v12 API；实际稳定版本以安装时 registry dist-tag 并写入 pnpm-lock 为准。Custom Node + Handle 渲染摘要；BaseEdge + SVG Bezier + EdgeLabelRenderer 支持独立多关系曲线；稳定 nodeTypes/edgeTypes，节点 memo。图布局与 LLM 均不属于 React Flow 职责。

| 引擎 | 自由网络/循环 | 重叠与交叉 | 固定点/性能 | 取舍 |
| --- | --- | --- | --- | --- |
| d3-force | 自然适配无层级网络 | collision 避免节点重叠，不保证消除交叉 | fx/fy 固定点，可离线 tick、Worker | MVP；停止模拟后再交互，避免持续漂移 |
| ELK.js | 支持多个布局算法；layered 偏有向 | 边路由能力强，参数较多 | 支持异步 Worker，配置复杂 | 后续结构化模式，不先引入第二引擎 |
| Dagre | 偏向层级有向图 | 层级排列，复杂环网络语义较弱 | 简单快速，固定位置灵活性较差 | 不作为人物网络默认布局 |

官方资料：
- https://reactflow.dev/learn/customization/custom-nodes
- https://reactflow.dev/learn/customization/custom-edges
- https://reactflow.dev/learn/customization/handles
- https://reactflow.dev/examples
- https://d3js.org/d3-force/simulation
- https://github.com/kieler/elkjs
- https://github.com/dagrejs/dagre

## 组件与状态
CharacterGraph 管理 React Flow 节点坐标、视口、筛选；CharacterNode 只接受 CharacterNodeData；RelationshipEdge 接受关系 ID、标签和曲线通道。CharacterInspector/CharacterProfileForm、RelationshipInspector 负责表单。GraphToolbar 负责搜索、过滤、布局和上传。
TanStack Query 以 project_id 和 story_id 区分业务数据；React 本地状态管理 InspectorSelection（none/character/relationship）、表单草稿和交互节点。布局独立版本；拖动结束保存，不随 pointermove 写库。打开或关闭详情抽屉不平移、不缩放画布，节点点击不 fitView。新增节点才补初始坐标，编辑不重新布局。

## 数据模型与权限
新增 characters 模块。PostgreSQL 是唯一事实源，人物/关系/布局/文档/片段/证据/分析任务分别存储。UUID 稳定标识；项目关联对象使用项目复合外键。多重关系无人物对唯一约束；关系时间线属于关系档案，预留独立事件表。profile_data 使用 schema_version=1 的 Pydantic Schema；属性含 value/source_type/evidence_refs/confidence/review_status。未知值为空；user 来源不允许模型覆盖。
所有查询先通过 ProjectService 授权；写入使用 authorize_content_write 和版本锁。Router 仅 DTO/HTTP，Service 持有 UoW，Repository 不提交。来源对象通过既有存储服务保存，不在节点/日志中复制全文。证据必须校验片段偏移和原文精确匹配。

## API
前缀 /api/v1/projects/{project_id}/stories/{story_id}。characters 与 relationships 提供列表/创建/详情/PATCH/DELETE；PATCH 带 expected_version。character-graph 返回摘要和布局，layout PUT 带 expected_version。scripts 登记文件；character-analysis POST 带幂等键、GET 状态、取消/重试/审核结果。evidence/{id} 返回已授权原文位置。详情类型通过 OpenAPI 生成，不手写平行 TS 契约。

## 文档与 AI
复用对象存储、已有模型能力指定和文本 Worker。当前仓库没有统一 Parser 实现，新增基础设施 Parser 统一处理 TXT/Markdown/DOCX/文本 PDF；扫描 PDF 明确提示不支持 OCR。限制字节、解压大小、页数和文本长度，拒绝空文档/错误编码；checksum 在同一剧本内查重。
阶段：parsing → extracting → resolving → validating → review。任务状态使用 queued/running/succeeded/failed/canceled，阶段独立。段落优先分块，保留 offset/overlap，无章节依据则为空。每段成功结果持久化；严格 Pydantic 输出验证、有限重试，不依赖付费测试。跨片段别名与同名人物保留歧义建议，不自动强制合并。模型没有工具权限，剧本仅是数据。
AI 结果与正式人物分离，用户审核后合并；重分析不修改人工档案。模型调用在事务外，领取/结果提交用短事务，取消后不发布结果。恢复从成功检查点继续；失败显示可行动错误，不能伪造分析进度。

## 实施与验证
1. 调研、ADR 与此设计。
2. 模型、迁移、Schema、Repository/Service/权限测试。
3. React Flow、Inspector、布局、持久化、交互测试。
4. 上传/Parser/证据与安全边界。
5. LangChain 结构化分析与 Worker，模拟供应商测试。
6. 完整上传→分析→审核→编辑→刷新回归。
7. 10/30/100/300 人物布局压力测试，类型检查、构建、pytest、迁移。

主要风险：模型消歧不可靠（审核而非静默合并）、长文本成本（分块上限及检查点）、并发草稿覆盖（409版本冲突）、坐标更新竞态（串行保存）、存储/模型未配置（明确失败）。真实供应商质量与浏览器性能需单独验收，不能用 mock 结果替代。

## 人物形象资产（ADR-045）

多图资产独立持久化，不随人物文本保存提交。图片集合 `character_images` 引用 upload_files 或生成 assets；部分唯一索引与人物行锁保证单主图。第一张自动成为主图，删除主图按创建时间选取剩余图片。旧 avatar_upload_id 经 0027 迁移保留为主图；该字段不再由文本更新接口修改。剧本资源库按引用汇总这些图片，主图状态仍只由人物档案维护，移除剧本引用不会删除人物图片。

接口位于人物路径下：GET/POST images，PUT images/{id}/primary，DELETE images/{id}，POST image-generations（Idempotency-Key）。查询包括真实生成任务状态。新增引用校验上传归属；删除只解除人物引用，不销毁原始文件。生成资产仍被人物引用时拒绝作品删除。

AI 复用现有图片生成服务，人物图片任务关联与生成任务同事务入队；现有 image_generation Worker 负责后台收集并绑定结果，重试不会重复添加。文本候选模式和主要形象参考模式分离；参考模式必须通过模型能力校验。人物已删除时不恢复人物或图片关联；用户权限失效或结果已删除时记录绑定错误。

前端组件 CharacterImages / useCharacterImages 提供空态、批量上传、主图切换、删除确认、横向拖动和 Lightbox。整个 Inspector 接收外部文件拖拽，文本与内部拖动不触发上传。图片刷新只更新形象及图谱缓存，不覆盖未保存文本草稿；关闭侧栏不取消已经开始的文件上传与生成任务。

运行更新后需执行 `alembic upgrade head` 并重启现有图片 Worker。真实七牛上传与供应商质量需使用已配置模型另行验收；自动测试仅使用明确标识的模型/存储替身。
