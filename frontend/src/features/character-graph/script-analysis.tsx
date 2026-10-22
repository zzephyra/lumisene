import { Ellipsis, Pencil } from "lucide-react";
import { Download, Sparkles, Trash2, Undo2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnalysisDrawer, type AnalysisDocument } from "./analysis-drawer";
import type { components } from "../../api/schema";
import { Button } from "../../components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
import { remove, save, type Graph } from "./api";

type Job = components["schemas"]["AnalysisView"];

function job(value: unknown): Job {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.status !== "string" || typeof value.progress !== "number" || !isRecord(value.result)) {
    throw new Error("无效的分析状态");
  }
  return value as Job;
}

const menuItem = "graph-menu-item";
const mac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
function shortcutKeys(shortcut: string) {
  if (!mac) {
    const words = shortcut
      .replaceAll("⌘", "Ctrl ")
      .replaceAll("⇧", "Shift ")
      .replaceAll("⌫", "Del")
      .trim()
      .split(/\s+/);
    return { mods: words.slice(0, -1), key: words.at(-1) ?? "" };
  }
  const mods = [...shortcut].filter((char) => "⌘⇧⌥⌃".includes(char));
  const key = [...shortcut].filter((char) => !"⌘⇧⌥⌃".includes(char)).join("");
  return { mods, key };
}
function MenuAction({ icon: Icon, label, shortcut, disabled, destructive = false, onSelect }: { icon: typeof Upload; label: string; shortcut: string; disabled?: boolean; destructive?: boolean; onSelect: () => void }) {
  const keys = shortcutKeys(shortcut);
  return (
    <DropdownMenuItem className={menuItem} data-destructive={destructive || undefined} disabled={disabled} onSelect={onSelect}>
      <Icon aria-hidden size={16} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <kbd className="graph-shortcut">
        {keys.mods.length > 0 && (
          <span className="graph-shortcut-mods">
            {keys.mods.map((mod) => (
              <span key={mod}>{mod}</span>
            ))}
          </span>
        )}
        <span>{keys.key}</span>
      </kbd>
    </DropdownMenuItem>
  );
}

const documents = new Set(["txt", "md", "markdown", "docx", "pdf"]);

export function ScriptAnalysis({ projectId, storyId, characters, relationships, canUndo, onUndo, onAccepted, onEditStory, onNotice }: {
  onEditStory?: () => void;
  onNotice?: (message: string) => void;
  projectId: string;
  storyId: string;
  characters: Graph["characters"];
  relationships: Graph["relationships"];
  canUndo: boolean;
  onUndo: () => void;
  onAccepted: () => void;
}) {
  const root = `/api/v1/projects/${projectId}/stories/${storyId}`;
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingFile = useRef<File | null>(null);
  const [localDocument, setLocalDocument] = useState<AnalysisDocument | null>(null);
  const [detached, setDetached] = useState(false);
  const [pendingName, setPendingName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState(false);
  const [identity, setIdentity] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recent = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "character-analysis"],
    queryFn: async ({ signal }) => {
      const value = await apiRequest({ path: `${root}/character-analysis`, signal });
      if (!Array.isArray(value)) throw new Error("无效响应");
      return value.map(job);
    },
  });
  const id = identity ?? recent.data?.[0]?.id;
  const status = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "character-analysis", id],
    enabled: !!id,
    queryFn: async ({ signal }) => job(await apiRequest({ path: `${root}/character-analysis/${id}`, signal })),
    refetchInterval: (query) => (query.state.data && ["queued", "running"].includes(query.state.data.status) ? 1500 : false),
  });

  async function upload(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!documents.has(extension)) {
      pendingFile.current = null;
      setPendingName("");
      setError("请上传 TXT、Markdown、DOCX 或文字 PDF");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      pendingFile.current = null;
      setPendingName("");
      setError("文件不能超过 5 MB");
      return;
    }
    pendingFile.current = file;
    setPendingName(file.name);
    setUploading(true);
    setError("");
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
      const document = await apiRequest({ path: `${root}/scripts`, method: "POST", csrf: true, body: { filename: file.name, content_base64: btoa(binary) } });
      if (!isRecord(document) || typeof document.id !== "string") throw new Error("上传响应无效");
      setLocalDocument({ id: document.id, filename: typeof document.filename === "string" ? document.filename : file.name });
      setDetached(false);
      pendingFile.current = null;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  async function action(command: string) {
    setBusy(true);
    setError("");
    try {
      await apiRequest({ path: `${root}/character-analysis/${id}/${command}`, method: "POST", csrf: true });
      await status.refetch();
      if (command === "accept") onAccepted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const data = status.data;
  const currentDocument = localDocument ?? (detached || !data?.document_id ? null : { id: data.document_id, filename: "" });

  async function importFile(file: File) {
    if (file.name.toLowerCase().endsWith(".json")) {
      setBusy(true);
      setError("");
      try {
        const parsed: unknown = JSON.parse(await file.text());
        if (!isRecord(parsed) || !Array.isArray(parsed.characters)) throw new Error("无法识别的人物文件");
        const ids = new Map<string, string>();
        for (const item of parsed.characters) {
          if (!isRecord(item) || typeof item.name !== "string" || !item.name.trim()) continue;
          const created = await save(projectId, storyId, "character", {
            name: item.name.trim(),
            title: typeof item.title === "string" ? item.title : "",
            role_type: typeof item.role_type === "string" ? item.role_type : "",
          });
          ids.set(item.name.trim(), created.id);
        }
        if (Array.isArray(parsed.relationships)) {
          for (const item of parsed.relationships) {
            if (!isRecord(item) || typeof item.relationship_type !== "string") continue;
            const source = ids.get(String(item.source));
            const target = ids.get(String(item.target));
            if (!source || !target) continue;
            await save(projectId, storyId, "relationship", { source_character_id: source, target_character_id: target, relationship_type: item.relationship_type });
          }
        }
        onAccepted();
        onNotice?.("人物文件已导入");
      } catch (reason) {
        onNotice?.(reason instanceof Error ? reason.message : "导入失败");
      } finally {
        setBusy(false);
      }
      return;
    }
    setOpen(true);
    await upload(file);
  }

  function exportGraph() {
    const names = new Map(characters.map((item) => [item.id, item.name]));
    const payload = {
      characters: characters.map((item) => ({ name: item.name, title: item.title, role_type: item.role_type })),
      relationships: relationships.map((item) => ({
        source: names.get(item.source_character_id) ?? "",
        target: names.get(item.target_character_id) ?? "",
        relationship_type: item.relationship_type,
      })),
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "人物关系.json";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function clearGraph() {
    if (!window.confirm(`清除当前剧本的 ${characters.length} 个人物及其关系？清除后不能自动恢复。`)) return;
    setBusy(true);
    setError("");
    try {
      for (const item of characters) await remove(projectId, storyId, "character", item.id, item.version);
      onAccepted();
      onNotice?.("人物和关系已清除");
    } catch (reason) {
      onNotice?.(reason instanceof Error ? reason.message : "清除失败");
      onAccepted();
    } finally {
      setBusy(false);
    }
  }

  async function analyze() {
    if (data && ["queued", "running"].includes(data.status)) return;
    if (!currentDocument) {
      setError("导入文档后才能开始分析");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const created = job(await apiRequest({
        path: `${root}/character-analysis`,
        method: "POST",
        csrf: true,
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { document_id: currentDocument.id },
      }));
      setIdentity(created.id);
      void recent.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "分析失败");
    } finally {
      setBusy(false);
    }
  }

  const commands = useRef({
    open: () => fileRef.current?.click(),
    exportGraph,
    undo: onUndo,
    clear: () => void clearGraph(),
    analyze: () => setOpen(true),
    busy,
    canUndo,
    hasCharacters: characters.length > 0,
  });
  commands.current = {
    open: () => fileRef.current?.click(),
    exportGraph,
    undo: onUndo,
    clear: () => void clearGraph(),
    analyze: () => setOpen(true),
    busy,
    canUndo,
    hasCharacters: characters.length > 0,
  };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      const current = commands.current;
      if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        if (!current.busy) current.open();
      } else if (key === "e" && !event.shiftKey) {
        event.preventDefault();
        if (current.hasCharacters) current.exportGraph();
      } else if (key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (current.canUndo) current.undo();
      } else if (event.shiftKey && (event.key === "Backspace" || event.key === "Delete")) {
        event.preventDefault();
        if (current.hasCharacters && !current.busy) current.clear();
      } else if (event.shiftKey && key === "a") {
        event.preventDefault();
        if (!current.busy) current.analyze();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const running = !!data && ["queued", "running"].includes(data.status);

  return (
    <div className="script-analysis">
      <div className="script-analysis-tools">
        <Button className="story-icon graph-analyze" variant="ghost" aria-label="AI 分析" aria-expanded={open} aria-busy={running} onClick={() => setOpen(true)}>
          <Sparkles aria-hidden size={17} />
          <span className="graph-tip" aria-hidden>AI 分析</span>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button className="story-icon graph-more" aria-label="更多操作" variant="ghost" disabled={busy}>
              <Ellipsis size={17} />
              <span className="graph-tip" aria-hidden>更多</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="graph-action-menu">
            {onEditStory && (
              <>
                <DropdownMenuLabel data-slot="menu-label">故事</DropdownMenuLabel>
                <DropdownMenuItem className={menuItem} onSelect={onEditStory}><Pencil aria-hidden size={16} /><span>故事设置</span></DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuLabel data-slot="menu-label">文件</DropdownMenuLabel>
            <MenuAction icon={Upload} label="导入" shortcut="⌘O" disabled={busy} onSelect={() => fileRef.current?.click()} />
            <MenuAction icon={Download} label="导出" shortcut="⌘E" disabled={characters.length === 0} onSelect={exportGraph} />
            <DropdownMenuSeparator />
            <DropdownMenuLabel data-slot="menu-label">编辑</DropdownMenuLabel>
            <MenuAction icon={Undo2} label="回撤" shortcut="⌘Z" disabled={!canUndo} onSelect={onUndo} />
            <MenuAction icon={Trash2} label="清除" destructive shortcut="⌘⇧⌫" disabled={characters.length === 0 || busy} onSelect={() => void clearGraph()} />
            <DropdownMenuSeparator />
            <DropdownMenuLabel data-slot="menu-label">分析</DropdownMenuLabel>
            <MenuAction icon={Sparkles} label="AI 分析" shortcut="⌘⇧A" disabled={busy} onSelect={() => setOpen(true)} />
          </DropdownMenuContent>
        </DropdownMenu>
        <input ref={fileRef} aria-label="导入剧本或人物文件" className="sr-only" type="file" accept=".txt,.md,.markdown,.docx,.pdf,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ""; }} />
      </div>
      <AnalysisDrawer
        open={open}
        onOpenChange={setOpen}
        document={currentDocument}
        uploading={uploading}
        error={error}
        pendingName={pendingName}
        onUpload={(file) => void upload(file)}
        onRemove={() => {
          setLocalDocument(null);
          setDetached(true);
          pendingFile.current = null;
          setPendingName("");
          setError("");
        }}
        onRetryUpload={() => { if (pendingFile.current) void upload(pendingFile.current); }}
        job={data ?? null}
        busy={busy}
        existingNames={characters.map((item) => item.name)}
        onStart={() => void analyze()}
        onRetry={() => void action("retry")}
        onCancel={() => void action("cancel")}
        onApply={() => {
          if (window.confirm("确认把这些人物和关系作为新档案加入当前图？已有人物和关系不会被覆盖。")) void action("accept");
        }}
      />
    </div>
  );
}
