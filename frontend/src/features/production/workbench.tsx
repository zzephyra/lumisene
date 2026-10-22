import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Film,
  PanelRight,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { VideoPlayer } from "../../components/media/video-player";
import { Thumbnail } from "../video-editor/thumbnail-strip";
import { apiRequest } from "../../lib/api";
import { ShotInspector } from "./shot-inspector";
import {
  active,
  change,
  mediaUrl,
  message,
  moveShot,
  newScene,
  newShot,
  read,
  root,
  statusName,
  updateShot,
  type Board,
  type Capability,
  type Production,
  type Prompt,
  type Run,
  type Shot,
  type Scene,
} from "./api";
import "./production.css";
import { SourceSync } from "./source-sync";
import { Storyboard } from "./board-editor";
import { SourcePanel, sourceChapters } from "./source-panel";
import { SettingsForm } from "./settings-form";
import { resolveSettings, type Settings, type Impact } from "./api";

export function ProductionWorkbench({
  projectId,
  productionId,
  storyId,
}: {
  projectId: string;
  productionId: string;
  storyId: string;
}) {
  const client = useQueryClient();
  const path = root(projectId, storyId) + "/" + productionId;
  const key = ["projects", projectId, "productions", productionId];
  const query = useQuery({
    queryKey: key,
    queryFn: ({ signal }) => read<Production>(path, signal),
    refetchInterval: (query) =>
      query.state.data?.runs.some((r) => active(r.status)) ? 2500 : false,
  });
  const capabilities = useQuery({
    queryKey: ["projects", projectId, "production-capabilities"],
    queryFn: ({ signal }) =>
      read<Capability[]>(root(projectId) + "/capabilities", signal),
  });
  const [settingsDraft, setSettingsDraft] = useState<Settings | null>(null);
  const [sourceView, setSourceView] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [leftWidth, setLeftWidth] = useState(220);
  const [rightWidth, setRightWidth] = useState(320);
  const [past, setPast] = useState<Board[]>([]);
  const [future, setFuture] = useState<Board[]>([]);
  const impact = useQuery({
    queryKey: [...key, "source-impact"],
    queryFn: ({ signal }) => read<Impact>(path + "/source-impact", signal),
    enabled: !!query.data,
  });
  const [draft, setDraft] = useState<Board | null>(null);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [selection, setSelection] = useState("");
  const [tab, setTab] = useState("board");
  const [inspector, setInspector] = useState(true);
  const [preview, setPreview] = useState<{ id: string; kind: string } | null>(
    null,
  );
  const [modal, setModal] = useState<
    "plan" | "history" | "export" | "settings" | "source" | null
  >(null);
  const [planPreview, setPlanPreview] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [parameters, setParameters] = useState<Record<string, string | number>>(
    {},
  );
  const [dimensions, setDimensions] = useState("1920*1080");
  const dragging = useRef("");
  const submitting = useRef(false);
  const data = query.data;
  const settings = resolveSettings(data?.settings);
  const board = draft ?? data?.board;
  const scenes = board?.scenes ?? [];
  const shots = scenes.flatMap((s) => s.shots ?? []);
  const shot = shots.find((s) => s.id === selection);
  const scene = scenes.find((s) => s.shots?.some((v) => v.id === shot?.id));
  const dirty = !!draft;
  const persistedShot = data?.board.scenes
    ?.flatMap((s) => s.shots ?? [])
    .find((s) => s.id === shot?.id);
  const storageKey = `production-draft:${projectId}:${productionId}`;
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storageKey);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "board" in parsed &&
          "version" in parsed &&
          typeof parsed.version === "number" &&
          typeof parsed.board === "object" &&
          parsed.board !== null &&
          "scenes" in parsed.board &&
          Array.isArray(parsed.board.scenes)
        ) {
          setDraft(parsed.board as Board);
          setBaseVersion(parsed.version);
          setInfo("已恢复未保存的本地草稿。");
        }
      }
    } catch {
      setInfo("无法读取本地草稿");
    }
  }, [storageKey]);
  useEffect(() => {
    if (!draft) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ board: draft, version: baseVersion }),
      );
    } catch {
      setInfo("本地草稿保存失败，请及时保存到服务器");
    }
  }, [draft, baseVersion, storageKey]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  function edit(next: Board) {
    if (busy) return;
    if (board) setPast((p) => [...p.slice(-49), structuredClone(board)]);
    setFuture([]);
    setBaseVersion(baseVersion ?? data?.version ?? 1);
    setDraft(next);
  }
  function patch(value: Partial<Shot>) {
    if (board && shot) edit(updateShot(board, shot.id!, value));
  }
  function editScene(value: Partial<Scene>) {
    if (board && scene)
      edit({
        ...board,
        scenes: scenes.map((s) =>
          s.id === scene.id
            ? {
                ...s,
                ...value,
                shots: s.shots?.map((v) => ({ ...v, confirmed: false })),
              }
            : s,
        ),
      });
  }
  function received(value: Production, clear = false) {
    client.setQueryData(key, value);
    if (clear) {
      setDraft(null);
      setPast([]);
      setFuture([]);
      setBaseVersion(null);
      setPlanPreview(null);
      sessionStorage.removeItem(storageKey);
      setInfo("已保存");
    }
  }
  async function action(fn: () => Promise<Production>, clear = false) {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      received(await fn(), clear);
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  async function save() {
    if (!draft || !data) return;
    await action(
      () =>
        change(
          planPreview ? `${path}/plans/${planPreview}/apply` : path + "/board",
          planPreview ? "POST" : "PUT",
          { expected_version: baseVersion ?? data.version, board: draft },
        ),
      true,
    );
  }
  async function generate(kind: "image" | "video") {
    if (!shot || !data) return;
    await action(() =>
      change(
        `${path}/shots/${shot.id}/generate`,
        "POST",
        {
          expected_version: data.version,
          kind,
          parameters: kind === "video" ? videoParameters : {},
        },
        crypto.randomUUID(),
      ),
    );
  }
  const hasReference = !!(
    persistedShot?.selected_image_id ||
    persistedShot?.reference_upload_id ||
    persistedShot?.reference_asset_id ||
    persistedShot?.character_image_id
  );
  const videoCapability = capabilities.data?.find(
    (c) => c.operation === (hasReference ? "image_to_video" : "text_to_video"),
  );
  const imageCapability = capabilities.data?.find(
    (c) =>
      c.operation ===
      (persistedShot?.reference_upload_id ||
      persistedShot?.reference_asset_id ||
      persistedShot?.character_image_id
        ? "image_to_image"
        : "text_to_image"),
  );
  const videoOptions = Object.entries(
    videoCapability?.parameters ?? {},
  ).flatMap(([name, value]) =>
    Array.isArray(value) && value.length
      ? [
          {
            name,
            values: value.filter(
              (v): v is string | number =>
                typeof v === "string" || typeof v === "number",
            ),
          },
        ]
      : [],
  );
  const videoParameters = Object.fromEntries(
    videoOptions.map(({ name, values }) => [
      name,
      values.includes(parameters[name])
        ? parameters[name]
        : name === "duration" &&
            values.includes(persistedShot?.generation_duration ?? -1)
          ? persistedShot!.generation_duration!
          : values[0],
    ]),
  );
  const shotRuns = (data?.runs ?? []).filter((r) => r.shot_id === shot?.id);
  const pending = shotRuns.some((r) => active(r.status));
  const selectedMedia =
    preview ??
    (shot?.selected_video_id
      ? { id: shot.selected_video_id, kind: "video" }
      : shot?.selected_image_id
        ? { id: shot.selected_image_id, kind: "image" }
        : null);
  function select(id: string) {
    setSelection(id);
    setParameters({});
    setPreview(null);
  }
  function adopt(run: Run, id: string) {
    patch(
      run.kind === "image"
        ? { selected_image_id: id }
        : { selected_video_id: id },
    );
    setPreview({ id, kind: run.kind });
    setInfo("已选择版本，请保存分镜。");
  }
  async function buildPrompt() {
    if (dirty) {
      setError("请先保存分镜，再构建描述");
      return;
    }
    if (!shot) return;
    setBusy(true);
    setError("");
    try {
      const value = (await apiRequest({
        path: `${path}/shots/${shot.id}/prompt`,
        method: "POST",
        csrf: true,
      })) as Prompt;
      if (!value || typeof value.prompt !== "string")
        throw new Error("描述响应无效");
      setDraft(
        updateShot(board!, shot.id!, {
          prompt: value.prompt,
          confirmed: false,
        }),
      );
      setBaseVersion(data!.version);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  function undo() {
    if (busy || !past.length || !board) return;
    setFuture((f) => [board, ...f]);
    setDraft(past[past.length - 1]);
    setPast((p) => p.slice(0, -1));
  }
  function redo() {
    if (busy || !future.length || !board) return;
    setPast((p) => [...p, board]);
    setDraft(future[0]);
    setFuture((f) => f.slice(1));
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const typing =
        e.target instanceof HTMLElement &&
        !!e.target.closest("input,textarea,[contenteditable=true]");
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (!busy) void save();
      }
      if (!typing && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
      if (e.key === "Escape" && !modal) {
        setInspector(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  useEffect(() => {
    const short = settings.resolution === "720" ? 720 : 1080;
    const ratio = settings.aspect_ratio;
    const long = Math.round((short * 16) / 9);
    setDimensions(
      ratio === "9:16"
        ? `${short}*${long}`
        : ratio === "1:1"
          ? `${short}*${short}`
          : `${long}*${short}`,
    );
  }, [settings.aspect_ratio, settings.resolution]);
  if (query.isPending)
    return <div className="production-empty">正在载入制作工作台…</div>;
  if (!data)
    return (
      <div role="alert" className="production-empty">
        {message(query.error)}
        <Button onClick={() => void query.refetch()}>重试</Button>
      </div>
    );
  return (
    <section
      className="production-workbench"
      style={
        {
          "--production-left": `${leftWidth}px`,
          "--production-right": `${rightWidth}px`,
        } as CSSProperties
      }
    >
      <header className="production-toolbar">
        <div>
          <Link
            aria-label="返回剧本"
            to={`/projects/${projectId}/stories/${data.story_id}`}
          >
            <ArrowLeft size={18} />
          </Link>
          <div>
            <h1>{data.title}</h1>
            <small>
              {dirty ? "未保存更改" : `分镜 v${data.version}`} ·{" "}
              {pending ? "正在生成" : "制作中"}
            </small>
          </div>
        </div>
        <nav aria-label="制作阶段">
          {[
            ["board", "分镜"],
            ["generate", "生成"],
            ["timeline", "时间线"],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div>
          <Button
            variant="ghost"
            disabled={busy || dirty}
            onClick={() => {
              setSettingsDraft(settings);
              setModal("settings");
            }}
          >
            制作设置
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !past.length}
            onClick={undo}
          >
            撤销
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !future.length}
            onClick={redo}
          >
            重做
          </Button>
          <Button variant="ghost" onClick={() => setModal("history")}>
            生成记录
          </Button>
          <Button
            variant="outline"
            disabled={!dirty || busy}
            onClick={() => void save()}
          >
            <Save size={15} />
            {planPreview ? "采用规划" : "保存草稿"}
          </Button>
          <Button
            disabled={dirty || busy || !shots.length}
            onClick={() => setModal("export")}
          >
            导出视频
          </Button>
          <Button variant="ghost" onClick={() => setLeftOpen((v) => !v)}>
            导航
          </Button>
          <Button
            variant="ghost"
            aria-label="切换配置面板"
            onClick={() => setInspector(!inspector)}
          >
            <PanelRight size={18} />
          </Button>
        </div>
      </header>
      <div className="production-context">
        <button disabled={dirty || busy} onClick={() => setModal("source")}>
          {sourceChapters(data)
            .map((c) => c.title)
            .join("、") || "剧本快照"}
        </button>
        <span>
          目标 {settings.target_duration}s · 计划 {shots.length} 镜头 /{" "}
          {shots.reduce((n, s) => n + s.duration, 0).toFixed(1)}s
        </span>
        <span>{settings.mode === "smart" ? "智能模式" : "专业模式"}</span>
        {impact.data?.has_changes && (
          <button onClick={() => setModal("source")}>
            剧本有更新 · 查看影响
          </button>
        )}
      </div>
      {(error || info) && (
        <div className="production-feedback" role={error ? "alert" : "status"}>
          {error || info}
          <button
            aria-label="关闭提示"
            onClick={() => {
              setError("");
              setInfo("");
            }}
          >
            ×
          </button>
        </div>
      )}
      {dirty && baseVersion !== data.version && (
        <p role="alert" className="production-feedback">
          服务器分镜已更新，本地草稿未丢失。请复制需要保留的内容后重新载入，避免覆盖他人修改。
          <Button
            onClick={() => {
              setDraft(null);
              setBaseVersion(null);
              sessionStorage.removeItem(storageKey);
            }}
          >
            放弃草稿，载入服务器版本
          </Button>
        </p>
      )}
      <div
        className={`production-columns${inspector ? "" : " inspector-closed"}${leftOpen ? "" : " navigation-closed"}`}
      >
        <aside className="production-shot-list" hidden={!leftOpen}>
          <label className="production-panel-size">
            导航宽度
            <input
              type="range"
              min={150}
              max={360}
              value={leftWidth}
              onChange={(e) => setLeftWidth(Number(e.target.value))}
            />
          </label>
          <div className="production-list-actions">
            <Button
              variant="ghost"
              onClick={() => setSourceView(false)}
              aria-pressed={!sourceView}
            >
              分镜
            </Button>
            <Button
              variant="ghost"
              onClick={() => setSourceView(true)}
              aria-pressed={sourceView}
            >
              剧本
            </Button>
          </div>
          {sourceView ? (
            <SourcePanel data={data} />
          ) : (
            <>
              <div className="production-list-actions">
                <h2>场景与分镜</h2>
                <Button
                  variant="ghost"
                  aria-label="新增场景"
                  disabled={busy}
                  onClick={() =>
                    edit({ ...board!, scenes: [...scenes, newScene()] })
                  }
                >
                  <Plus size={16} />
                </Button>
              </div>
              <Button
                className="w-full"
                variant="outline"
                disabled={dirty || busy}
                onClick={() => setModal("plan")}
              >
                <Sparkles size={15} />
                AI 规划分镜
              </Button>
              {scenes.map((sc, sceneIndex) => (
                <section key={sc.id}>
                  <div className="production-list-actions">
                    <h3>
                      {sceneIndex + 1}. {sc.title}
                    </h3>
                    <Button
                      variant="ghost"
                      disabled={busy}
                      aria-label="新增镜头"
                      onClick={() => {
                        const next = newShot();
                        edit({
                          ...board!,
                          scenes: scenes.map((s) =>
                            s.id === sc.id
                              ? { ...s, shots: [...(s.shots ?? []), next] }
                              : s,
                          ),
                        });
                        select(next.id!);
                      }}
                    >
                      <Plus size={14} />
                    </Button>
                  </div>
                  {sc.shots?.map((s) => (
                    <button
                      className="production-shot-card"
                      key={s.id}
                      aria-pressed={shot?.id === s.id}
                      onClick={() => select(s.id!)}
                    >
                      <div className="production-shot-thumb">
                        {s.selected_image_id ? (
                          <img
                            src={mediaUrl(projectId, s.selected_image_id)}
                            alt="分镜图"
                            loading="lazy"
                          />
                        ) : (
                          <Film size={22} />
                        )}
                      </div>
                      <div>
                        <strong>
                          镜头 {shots.findIndex((x) => x.id === s.id) + 1}
                        </strong>
                        <p>{s.description || "未填写描述"}</p>
                        <small>
                          {s.duration}s 预计 · {s.confirmed ? "已确认" : "草稿"}
                        </small>
                        {board?.risks?.some((risk) => risk.includes(s.id!)) && (
                          <small className="production-quality-note">
                            可能存在重复镜头
                          </small>
                        )}
                      </div>
                    </button>
                  ))}
                </section>
              ))}
            </>
          )}
        </aside>
        <main className="production-stage">
          {tab === "board" ? (
            <Storyboard
              projectId={projectId}
              board={board!}
              selected={shot?.id}
              onSelect={(id) => {
                select(id);
                setInspector(true);
              }}
              onEdit={edit}
              disabled={busy}
            />
          ) : tab === "timeline" ? (
            <>
              <h2>片段时间线</h2>
              <p className="text-muted">
                拖拽调整镜头顺序，也可使用左右按钮；调整后保存。显示的时长为分镜预计时长，导出使用媒体实际时长。
              </p>
              <div className="production-timeline">
                {shots.map((s, index) => (
                  <article
                    key={s.id}
                    draggable={!busy}
                    onDragStart={() => {
                      dragging.current = s.id!;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      edit(moveShot(board!, dragging.current, s.id!));
                    }}
                  >
                    <button
                      onClick={() => {
                        select(s.id!);
                        setTab("generate");
                      }}
                    >
                      <div className="production-timeline-thumb">
                        {s.selected_video_id ? (
                          <Thumbnail
                            url={mediaUrl(projectId, s.selected_video_id)}
                            frame={0}
                          />
                        ) : (
                          <span>待生成</span>
                        )}
                      </div>
                      <strong>
                        {index + 1}. {s.description?.slice(0, 30) || "镜头"}
                      </strong>
                      <small>
                        {s.duration}s 预计 ·{" "}
                        {s.selected_video_id ? "已采用视频" : "未完成"}
                      </small>
                    </button>
                    <div>
                      <Button
                        variant="ghost"
                        aria-label="向前移动"
                        disabled={index === 0 || busy}
                        onClick={() =>
                          edit(moveShot(board!, s.id!, shots[index - 1].id!))
                        }
                      >
                        <ChevronLeft size={14} />
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label="向后移动"
                        disabled={index === shots.length - 1 || busy}
                        onClick={() =>
                          edit(moveShot(board!, shots[index + 1].id!, s.id!))
                        }
                      >
                        <ChevronRight size={14} />
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            </>
          ) : shot ? (
            <>
              <div className="production-preview-heading">
                <h2>
                  镜头 {shots.indexOf(shot) + 1} <small>{scene?.title}</small>
                </h2>
                <Button
                  variant="ghost"
                  aria-label="删除镜头"
                  disabled={busy}
                  onClick={() => {
                    edit({
                      ...board!,
                      scenes: scenes.map((s) => ({
                        ...s,
                        shots: s.shots?.filter((v) => v.id !== shot.id),
                      })),
                    });
                    setPreview(null);
                  }}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              <div className="production-media-stage">
                {selectedMedia?.kind === "video" ? (
                  <VideoPlayer
                    key={selectedMedia.id}
                    src={mediaUrl(projectId, selectedMedia.id)}
                  />
                ) : selectedMedia ? (
                  <img
                    src={mediaUrl(projectId, selectedMedia.id)}
                    alt="生成分镜画面"
                  />
                ) : (
                  <div className="production-empty">
                    <Clapperboard size={42} />
                    <h3>{pending ? "镜头正在生成" : "镜头预览"}</h3>
                    <p>
                      {pending
                        ? "任务已交给生成 Worker，可切换镜头或离开页面。"
                        : "确认镜头后生成分镜图，再以首帧生成视频。"}
                    </p>
                  </div>
                )}
              </div>
              <div className="production-generation">
                <div>
                  <small>当前视频模型</small>
                  <strong>{videoCapability?.model_name ?? "未配置"}</strong>
                </div>
                {videoOptions.map(({ name, values }) => (
                  <Select
                    key={name}
                    id={`production-${name}`}
                    label={
                      {
                        duration: "时长",
                        size: "画面尺寸",
                        resolution: "清晰度",
                      }[name] ?? name
                    }
                    value={String(videoParameters[name])}
                    options={values.map((v) => ({
                      value: String(v),
                      label: String(v),
                    }))}
                    onChange={(v) =>
                      setParameters({
                        ...parameters,
                        [name]: name === "duration" ? Number(v) : v,
                      })
                    }
                  />
                ))}
                <Button
                  variant="outline"
                  disabled={
                    dirty ||
                    busy ||
                    pending ||
                    !shot.confirmed ||
                    !imageCapability?.available
                  }
                  onClick={() => void generate("image")}
                >
                  生成分镜图
                </Button>
                <Button
                  disabled={
                    dirty ||
                    busy ||
                    pending ||
                    !shot.confirmed ||
                    !videoCapability?.available
                  }
                  onClick={() => void generate("video")}
                >
                  生成视频
                </Button>
              </div>
              {dirty || !shot.confirmed ? (
                <p className="text-muted">请先保存镜头并确认后再生成。</p>
              ) : null}
              {videoCapability?.reason && (
                <p role="alert">视频：{videoCapability.reason}</p>
              )}
              {imageCapability?.reason && (
                <p role="alert">图片：{imageCapability.reason}</p>
              )}
              <p className="text-muted">
                {hasReference
                  ? "以所选分镜图或参考图片作为首帧。"
                  : "当前采用文生视频，未提供视觉参考。"}{" "}
                不支持尾帧、多图身份锁定和独立负面提示词。
              </p>
              <h3>当前镜头的生成版本</h3>
              <div className="production-versions">
                {shotRuns.length === 0 ? (
                  <p className="text-muted">
                    尚未生成。每次生成都会保留独立版本。
                  </p>
                ) : (
                  shotRuns.map((run) => (
                    <article key={run.id}>
                      <div>
                        <strong>
                          {run.kind === "image" ? "分镜图" : "视频"}
                        </strong>
                        <span>{statusName(run.status)}</span>
                        <small>
                          {new Date(run.created_at).toLocaleTimeString()}
                        </small>
                      </div>
                      {run.error && <p role="alert">{run.error}</p>}
                      {run.output_asset_ids?.map((id) => (
                        <div className="production-version-actions" key={id}>
                          <Button
                            variant="ghost"
                            onClick={() => setPreview({ id, kind: run.kind })}
                          >
                            预览
                          </Button>
                          <Button
                            variant="outline"
                            disabled={busy}
                            onClick={() => adopt(run, id)}
                          >
                            {(run.kind === "image"
                              ? shot.selected_image_id
                              : shot.selected_video_id) === id
                              ? "已选择"
                              : "采用此版本"}
                          </Button>
                          <a
                            href={mediaUrl(projectId, id)}
                            target="_blank"
                            rel="noreferrer"
                          >
                            下载
                          </a>
                        </div>
                      ))}
                      {!active(run.status) && (
                        <Button
                          variant="ghost"
                          disabled={busy || dirty}
                          onClick={() =>
                            void action(() =>
                              change(path + `/versions/${run.id}`, "DELETE"),
                            )
                          }
                        >
                          移除版本记录
                        </Button>
                      )}
                    </article>
                  ))
                )}
              </div>
            </>
          ) : (
            <div className="production-empty">
              <Clapperboard size={42} />
              <h2>先规划你的故事</h2>
              <p>AI 建议可编辑；确认后才会生成图片和视频。</p>
              <Button disabled={dirty || busy} onClick={() => setModal("plan")}>
                开始规划分镜
              </Button>
            </div>
          )}
        </main>
        {inspector && (
          <aside className="production-inspector">
            <label className="production-panel-size">
              面板宽度
              <input
                type="range"
                min={260}
                max={480}
                value={rightWidth}
                onChange={(e) => setRightWidth(Number(e.target.value))}
              />
            </label>
            {shot && scene ? (
              <ShotInspector
                projectId={projectId}
                storyId={data.story_id}
                shot={shot}
                scene={scene}
                onChange={patch}
                onScene={editScene}
                onPrompt={() => void buildPrompt()}
                disabled={busy}
              />
            ) : (
              <div className="production-inspector-form">
                <h2>制作概览</h2>
                <p>
                  目标 {settings.target_duration} 秒 · {settings.aspect_ratio} ·{" "}
                  {settings.resolution}p
                </p>
                <p>{settings.visual_style || "尚未指定视觉风格"}</p>
                <Button
                  disabled={dirty || busy}
                  onClick={() => {
                    setSettingsDraft(settings);
                    setModal("settings");
                  }}
                >
                  编辑全局设置
                </Button>
                <p className="text-muted">选择镜头后显示该镜头的专属配置。</p>
              </div>
            )}
            <Button
              className="production-mobile-close"
              onClick={() => setInspector(false)}
            >
              关闭配置
            </Button>
          </aside>
        )}
      </div>
      <Dialog
        open={modal === "settings"}
        onOpenChange={(v) => !v && !busy && setModal(null)}
      >
        <DialogContent className="production-wizard">
          <DialogTitle>制作设置</DialogTitle>
          <DialogDescription>
            切换模式不会丢失镜头。调整时长后需重新规划或编辑分镜，不会自动改写已有结果。
          </DialogDescription>
          {settingsDraft && (
            <SettingsForm value={settingsDraft} onChange={setSettingsDraft} />
          )}
          <Button
            disabled={busy || !settingsDraft}
            onClick={async () => {
              if (
                await action(() =>
                  change(path + "/settings", "PUT", {
                    expected_version: data.version,
                    settings: settingsDraft,
                  }),
                )
              )
                setModal(null);
            }}
          >
            保存设置
          </Button>
          {error && <p role="alert">{error}</p>}
        </DialogContent>
      </Dialog>
      {modal === "source" && (
        <SourceSync
          projectId={projectId}
          data={data}
          onClose={() => setModal(null)}
          onSaved={(value) => {
            received(value);
            void impact.refetch();
          }}
        />
      )}
      <Dialog
        open={modal === "plan"}
        onOpenChange={(v) => !busy && !v && setModal(null)}
      >
        <DialogContent>
          <DialogTitle>AI 分镜规划</DialogTitle>
          <DialogDescription>
            基于创建任务时保存的剧本快照。结果先预览，采用时才会替换当前分镜；不会修改原始剧本。
          </DialogDescription>
          <label>
            视觉风格与规划要求
            <textarea
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              maxLength={1000}
              placeholder="例如：克制的电影感，以中近景呈现人物冲突"
            />
          </label>
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={busy}
            onClick={async () => {
              if (
                await action(() =>
                  change(
                    path + "/plans",
                    "POST",
                    { expected_version: data.version, instruction },
                    crypto.randomUUID(),
                  ),
                )
              )
                setModal("history");
            }}
          >
            生成可编辑分镜建议
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === "history"}
        onOpenChange={(v) => !busy && !v && setModal(null)}
      >
        <DialogContent className="production-history">
          <DialogTitle>生成记录</DialogTitle>
          <DialogDescription>
            任务状态来自服务器。移除版本记录不会删除原始资产，原文件在资产库按系统存储策略管理。
          </DialogDescription>
          {data.runs.length === 0 ? (
            <p>还没有生成记录。</p>
          ) : (
            data.runs.map((run) => (
              <article key={run.id}>
                <h3>
                  {run.kind === "plan"
                    ? "分镜规划"
                    : run.kind === "export"
                      ? "视频导出"
                      : run.kind === "image"
                        ? "分镜图"
                        : "镜头视频"}{" "}
                  · {statusName(run.status)}
                </h3>
                <small>{new Date(run.created_at).toLocaleString()}</small>
                {run.error && <p role="alert">{run.error}</p>}
                {run.result && !run.applied && (
                  <Button
                    disabled={dirty || busy}
                    onClick={() => {
                      setDraft(run.result!);
                      setBaseVersion(data.version);
                      setPlanPreview(run.id);
                      setModal(null);
                      setTab("board");
                      setInfo("正在预览 AI 建议，可编辑后点击“采用规划”。");
                    }}
                  >
                    预览并编辑规划
                  </Button>
                )}
                {run.applied && <small>已采用</small>}
                {run.kind === "export" &&
                  run.output_asset_ids?.map((id) => (
                    <div key={id}>
                      <VideoPlayer src={mediaUrl(projectId, id)} />
                      <a
                        href={mediaUrl(projectId, id)}
                        target="_blank"
                        rel="noreferrer"
                      >
                        打开 MP4
                      </a>
                    </div>
                  ))}
                {run.editor_document_id && (
                  <Link
                    to={`/projects/${projectId}/editor/${run.editor_document_id}`}
                  >
                    打开剪辑工程
                  </Link>
                )}
              </article>
            ))
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={modal === "export"}
        onOpenChange={(v) => !busy && !v && setModal(null)}
      >
        <DialogContent>
          <DialogTitle>合成为完整视频</DialogTitle>
          <DialogDescription>
            所有镜头需确认并采用视频。后台统一帧率、尺寸与编码，导出 H.264
            MP4；保留可用音轨，没有音轨的片段补静音。
          </DialogDescription>
          <Select
            id="export-size"
            label="导出画幅"
            value={dimensions}
            onChange={setDimensions}
            options={[
              { value: "1920*1080", label: "横屏 16:9" },
              { value: "1080*1920", label: "竖屏 9:16" },
              { value: "1080*1080", label: "方形 1:1 · 1080p" },
              { value: "1280*720", label: "横屏 16:9 · 720p" },
              { value: "720*1280", label: "竖屏 9:16 · 720p" },
              { value: "720*720", label: "方形 1:1 · 720p" },
            ]}
          />
          {error && <p role="alert">{error}</p>}
          <Button
            disabled={busy}
            onClick={async () => {
              const [width, height] = dimensions.split("*").map(Number);
              if (
                await action(() =>
                  change(
                    path + "/exports",
                    "POST",
                    { expected_version: data.version, width, height },
                    crypto.randomUUID(),
                  ),
                )
              )
                setModal("history");
            }}
          >
            提交导出任务
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
