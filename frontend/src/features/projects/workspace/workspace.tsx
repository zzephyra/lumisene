import { CreativeChat } from "../../chat/creative-chat";
import { brand } from "../../../brand";
import { useEffect, useState } from "react";
import { Link, NavLink, Navigate, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Check, ChevronDown, CircleHelp, Clapperboard, Copy, Film, FolderOpen, Menu, MessageSquare, Plus, ShieldCheck, Sparkles, WandSparkles } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { LumiMark } from "../../../components/brand/LumiLogo";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../../components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../../components/ui/dropdown-menu";
import { AccountMenu } from "../../auth";
import type { Project } from "../types";
import { roleLabel, spaceLabel } from "../types";
import { listProjects, projectListQueryKey } from "../api";
import { CreateProjectDialog } from "../create-project-dialog";
import { creativePresets } from "./presets";
import { ProfilePage } from "../../profile";
import { GenerationPage } from "./generation-page";
import { AssetLibrary } from "./asset-library";
import { referenceFromLocation } from "./reference-asset";
import "./workspace.css";

const presetIcons = { story: MessageSquare, brand: Clapperboard, world: Sparkles, shot: Film };

export function Workspace({ project }: { project: Project }) {
  const base = `/projects/${project.id}`;
  const location = useLocation();
  const suffix = location.pathname.replace(/\/$/, "").slice(base.length);
  const page = suffix === "/assets" ? "assets" : suffix === "/generation" ? "generation" : suffix === "/profile" ? "profile" : "create";
  const [mobileOpen, setMobileOpen] = useState(false);
  const [chatActive, setChatActive] = useState(false);
  const [draft, setDraft] = useState("");
  const [generationPrompt, setGenerationPrompt] = useState("");
  const [generationType, setGenerationType] = useState<"video" | "image">("video");
  const [assetType, setAssetType] = useState("全部作品");
  const [assetSearch, setAssetSearch] = useState("");
  const [view, setView] = useState("grid");
  const [dialog, setDialog] = useState<"help" | "draft" | "clear" | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const navigate = useNavigate();
  const spaces = useQuery({
    queryKey: projectListQueryKey,
    queryFn: ({ signal }) => listProjects(null, signal),
    retry: false,
  });
  const currentLabel = spaceLabel(project);
  useEffect(() => {
    if (!draft.trim() && !generationPrompt.trim()) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, generationPrompt]);
  const referenceAsset = referenceFromLocation(location.state);
  const title = page === "assets" ? "资产" : page === "generation" ? "生成" : page === "profile" ? "个人主页" : "创作";
  if (!["", "/assets", "/generation", "/profile"].includes(suffix)) return <Navigate replace to={base} />;
  function fillPrompt(prompt: string) { setDraft(prompt); document.getElementById("creative-draft")?.focus(); }
  async function copy(text: string) {
    try { await navigator.clipboard.writeText(text); setCopyStatus("已复制到剪贴板"); }
    catch { setCopyStatus("复制失败，请手动选择并复制内容"); }
  }
  function navItems() {
    return <>{[{ label: "创作", to: base, icon: MessageSquare, end: true }, { label: "资产", to: `${base}/assets`, icon: FolderOpen, end: false }, { label: "生成", to: `${base}/generation`, icon: WandSparkles, end: false }].map(item => <NavLink key={item.label} to={item.to} end={item.end} onClick={() => setMobileOpen(false)} className={({ isActive }) => `workspace-nav-item${isActive ? " active" : ""}`}><item.icon size={19} /><span>{item.label}</span><span className="nav-active-dot" /></NavLink>)}</>;
  }
  return <div className={`workspace${page === "create" && chatActive ? " workspace-chat-active" : ""}`}>
    <aside className="workspace-sidebar" aria-label="工作区侧边栏">
      <Link to={base} className="workspace-brand" aria-label={brand.name}><LumiMark width={32} height={32} /><span>{brand.name}</span></Link>
      
      <nav aria-label="工作区导航">{navItems()}</nav>
      <div className="sidebar-bottom"><div className="project-private"><ShieldCheck size={15} /><span>独立空间</span></div><Button variant="ghost" className="sidebar-help" onClick={() => setDialog("help")}><CircleHelp size={17} /><span>使用帮助</span></Button><Link to="/projects" className="sidebar-back"><ArrowLeft size={16} /><span>管理空间</span></Link></div>
    </aside>
    <div className="workspace-main">
      <header className="workspace-header"><div className="workspace-breadcrumb"><Button variant="ghost" className="workspace-mobile-toggle" aria-label="打开工作区导航" onClick={() => setMobileOpen(true)}><Menu size={20} /></Button><DropdownMenu><DropdownMenuTrigger className="project-switch" aria-label="创作空间" title="创作空间"><span className="project-avatar"><FolderOpen size={16} aria-hidden /></span><span>{currentLabel}</span><ChevronDown size={13} /></DropdownMenuTrigger><DropdownMenuContent align="start" className="workspace-space-menu">{(spaces.data?.items ?? []).map((item) => <DropdownMenuItem key={item.id} onSelect={() => navigate(`/projects/${item.id}`)}><FolderOpen size={15} /><span>{spaceLabel(item)}</span>{item.id === project.id && <Check size={14} className="ml-auto text-primary" />}</DropdownMenuItem>)}{spaces.isError ? <DropdownMenuItem onSelect={() => void spaces.refetch()}>无法加载空间，重试</DropdownMenuItem> : null}<DropdownMenuItem onSelect={() => setCreateOpen(true)}>新建创作空间</DropdownMenuItem><DropdownMenuItem onSelect={() => navigate("/projects")}>管理创作空间</DropdownMenuItem></DropdownMenuContent></DropdownMenu><span className="breadcrumb-divider" aria-hidden>›</span><span className="workspace-current-page">{title}</span></div><div className="workspace-header-actions"><span className="workspace-role">{roleLabel(project.role)}</span><AccountMenu /></div></header>

      {page === "create" && <main className={`workspace-create${chatActive ? " chat-active" : ""}`}>
        <div className="create-toolbar"><span><span className="workspace-status-dot" /> 灵感从这里开始</span><Button variant="ghost" onClick={() => { if (draft) setDialog("clear"); else document.getElementById("creative-draft")?.focus(); }}><Plus size={16} /> 新建草稿</Button></div>
        <div className="creative-center"><div className="chat-welcome" inert={chatActive}><div className="workspace-eyebrow">YOUR IMAGINATION, IN MOTION</div><h1>和 {brand.name} 一起开始创作</h1><p className="creative-subtitle">从文字、图片或视频开始。</p><div className="creative-modes"><span><Sparkles size={16} /> 创意对话</span><Link to={`${base}/generation`}><Film size={16} /> 图片与视频 <ArrowUpRight size={13} /></Link></div></div>
          <CreativeChat onActiveChange={setChatActive} key={project.id} projectId={project.id} draft={draft} onDraftChange={setDraft} onGenerate={(kind, prompt) => { setGenerationType(kind); setGenerationPrompt(prompt); navigate(`${base}/generation`); }} />
          <div className="chat-welcome-extras" inert={chatActive}><div className="preset-grid">{creativePresets.map(preset => { const Icon = presetIcons[preset.kind]; return <button key={preset.id} className="preset-card" onClick={() => fillPrompt(preset.prompt)}><Icon size={20} /><span><strong>{preset.label}</strong></span><ArrowUpRight size={15} /></button>; })}</div>
          <p className="workspace-isolation"><ShieldCheck size={13} /> 这个创作空间和其他空间分开，不会自动带入其他空间的资料、对话或记忆。</p></div>
        </div>
        <section className="inspiration-section" inert={chatActive} aria-label="创作灵感"><div className="inspiration-heading"><div><span className="workspace-eyebrow">THE NEXT POSSIBILITY</span><h2>灵感，不止一种可能</h2></div><span>概念参考 · 点击带入创作需求</span></div><div className="inspiration-grid">{[
          { title: "去往，未被定义的世界", subtitle: "世界观探索", image: "/images/lumi-world.png", preset: creativePresets[2], tag: "WORLD BUILDING" },
          { title: "让平凡，成为电影的一幕", subtitle: "光影与叙事", image: "https://images.unsplash.com/photo-1441974231531-c6227db76b6e?auto=format&fit=crop&w=1000&q=85", preset: creativePresets[0], tag: "VISUAL STORY" },
          { title: "在夜色中，寻找新的视角", subtitle: "镜头语言", image: "https://images.unsplash.com/photo-1519608487953-e999c86e7455?auto=format&fit=crop&w=1000&q=85", preset: creativePresets[3], tag: "CINEMATIC MOOD" },
        ].map(item => <button className="inspiration-card" key={item.tag} onClick={() => fillPrompt(item.preset.prompt)}><img src={item.image} alt="" loading="lazy" /><span className="inspiration-tag">{item.tag}</span><span className="inspiration-caption"><small>{item.subtitle}</small><strong>{item.title}</strong></span><span className="inspiration-arrow"><ArrowUpRight size={19} /></span></button>)}</div></section>
        <footer className="workspace-bottomline"><span>FROM CONTEXT TO CINEMA.</span><span>每一个想法，都值得一帧。</span></footer>
      </main>}

      {page === "assets" && <AssetLibrary projectId={project.id} assetSearch={assetSearch} assetType={assetType} onGenerate={(asset) => navigate(`${base}/generation`, { state: { referenceAsset: asset } })} setAssetSearch={setAssetSearch} setAssetType={setAssetType} setView={setView} view={view} />}

      {page === "generation" && <GenerationPage editAsset={new URLSearchParams(location.search).get("editAsset")} onClearReference={() => navigate(`${base}/generation`, { replace: true, state: null })} projectId={project.id} generationType={generationType} referenceAsset={referenceAsset} setGenerationType={setGenerationType} prompt={generationPrompt} setPrompt={setGenerationPrompt} />}
      {page === "profile" && <ProfilePage projectId={project.id} />}

    </div>
    <Dialog open={mobileOpen} onOpenChange={setMobileOpen}><DialogContent className="workspace-mobile-menu"><DialogTitle>工作区导航</DialogTitle><DialogDescription>切换当前创作空间的工作页面</DialogDescription><nav aria-label="移动工作区导航">{navItems()}</nav><Link to="/projects">管理创作空间</Link></DialogContent></Dialog>
    <Dialog open={dialog !== null} onOpenChange={open => { if (!open) setDialog(null); }}><DialogContent className="workspace-dialog"><DialogTitle className="text-xl">{dialog === "help" ? "你的创作工作区" : dialog === "clear" ? "开始新的需求草稿？" : "创作需求预览"}</DialogTitle><DialogDescription className="mt-3 text-muted">{dialog === "help" ? "创作页可与 Lumi 多轮对话，发送后自动保存到当前空间。识别到图片或视频创作需求时会提供方案，确认后进入生成页。未发送的输入不会保存，新对话不带入其他会话历史。" : dialog === "clear" ? "这将清空当前输入。尚未复制的内容将丢失，不会删除任何服务端对话。" : `这是一份本地需求草稿，属于「${currentLabel}」，尚未发送给 AI，也未保存。`}</DialogDescription>{dialog === "draft" && <><p className="workspace-draft-preview">{draft}</p><Button onClick={() => void copy(draft)}><Copy size={15} /> 复制需求</Button><p className="mt-3 text-sm text-muted" role="status">{copyStatus}</p></>}{dialog === "clear" && <div className="mt-6 flex justify-end gap-3"><Button variant="outline" onClick={() => setDialog(null)}>保留草稿</Button><Button onClick={() => { setDraft(""); setDialog(null); document.getElementById("creative-draft")?.focus(); }}>清空并新建</Button></div>}{dialog === "help" && <Button className="mt-6" onClick={() => setDialog(null)}><Check size={15} /> 知道了</Button>}</DialogContent></Dialog>
    <CreateProjectDialog onOpenChange={setCreateOpen} open={createOpen} />
  </div>;
}
