import { Puzzle, LayoutDashboard, Users, Clapperboard, FolderOpen, Film, ShieldCheck, ScrollText, Library, SlidersHorizontal, Settings } from "lucide-react";

export const ADMIN_GROUPS = ["工作台", "平台运营", "模型与服务", "安全与治理"];
export const ADMIN_MODULES = [
  { path: "/admin", title: "控制台总览", icon: LayoutDashboard, group: "工作台", planned: false, description: "查看模型配置概况与管理能力。", features: [] },
  { path: "/admin/users", title: "用户管理", icon: Users, group: "平台运营", planned: false, description: "管理创作者账号，定位账户访问问题。", features: ["按邮箱、账号状态和创建时间查找用户", "查看账户资料、所属空间数量与最近登录时间", "停用或恢复账号、撤销会话，并保留操作记录"] },
  { path: "/admin/tasks", title: "生成任务", icon: Clapperboard, group: "平台运营", planned: false, description: "追踪图片与视频从提交到完成的生成链路。", features: ["按任务类型、状态、供应商和时间筛选", "查看排队耗时、执行耗时、错误原因与请求编号", "区分失败、取消中与结果待核对，避免重复提交产生费用"] },
  { path: "/admin/assets", title: "资产管理", icon: FolderOpen, group: "平台运营", planned: false, description: "掌握上传素材和生成作品的存储情况。", features: ["区分用户上传、AI 生成和编辑器导出资源", "按类型、大小、所属空间和创建时间检索", "查看存储用量与引用关系，受控清理无引用资源"] },
  { path: "/admin/exports", title: "视频导出", icon: Film, group: "平台运营", planned: false, description: "单独追踪编辑器渲染任务与导出结果。", features: ["按排队、运行、成功、失败和取消筛选导出任务", "查看分辨率、时长、文档版本与渲染耗时", "定位渲染失败原因，按任务允许动作处理异常"] },
  { path: "/admin/settings", title: "系统设置", icon: Settings, group: "平台运营", planned: false, description: "配置作品删除时是否清理七牛云文件。", features: ["选择保留云端文件或同步清理", "保存后后续删除立即使用新策略", "已排队的清理任务保持原策略"] },
  { path: "/admin/skills", title: "技能管理", icon: Puzzle, group: "模型与服务", planned: false, description: "维护创作技能与提示词版本，管理激活状态。", features: [] },
  { path: "/admin/models", title: "模型目录", icon: Library, group: "模型与服务", planned: false, description: "登记模型版本，查看能力与启用状态。", features: [] },
  { path: "/admin/assignments", title: "业务指定", icon: SlidersHorizontal, group: "模型与服务", planned: false, description: "为文本、图片、视频等业务指定模型。", features: [] },
  { path: "/admin/moderation", title: "内容审核", icon: ShieldCheck, group: "安全与治理", planned: true, description: "建立素材与生成内容的审核处理流程。", features: ["将待处理、已处理与申诉内容分开管理", "在明确授权范围内查看举报原因和必要内容", "记录审核结论、处理理由与操作者，支持追溯"] },
  { path: "/admin/audit", title: "操作审计", icon: ScrollText, group: "安全与治理", planned: true, description: "追踪关键配置与管理操作的变更记录。", features: ["按操作者、操作类型、资源和时间检索", "查看模型登记、停用和业务指定变更", "展示脱敏记录及请求编号，不暴露密钥和会话令牌"] },
];
