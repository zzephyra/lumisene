import { WorksPanel } from "./works-panel";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from "../../../components/ui/alert-dialog";
import { OutpaintDebugLink } from "./outpaint-debug-link";
import { VideoPlayer } from "../../../components/media/video-player";
import { getEditorOptions, requestImageAction } from "../image-edit";
import { brand } from "../../../brand";
import { EditVideoButton, RecentEdits } from "../../video-editor";
import { Check, Copy, Film, Image, Plus, Sparkles, Trash2, WandSparkles, X } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";

import { GenerationLoadingCard, generationAspectRatio } from "../../../components/generation-loading";
import { Button } from "../../../components/ui/button";
import { LumiMark } from "../../../components/brand/LumiLogo";
import { userFacingMessage } from "../../../lib/api";
import { deleteWork, deletionMessage } from "../asset-deletion";
import { formatBytes } from "../../uploads";
import type { ReferenceAsset } from "./reference-asset";
import { imageParameters, type RatioId, type ResolutionId } from "../image-settings";
import {
  assetContentPath,
  createImageGeneration,
  getActiveImageModel,
  getImageGeneration,
  listImageGenerations,
  type GenerationTask,
  type ImageModel,
} from "../image-generation";
import { ImageSettingsMenu } from "./image-settings-menu";
import "./generation-studio.css";

const ImageEditor = lazy(() => import("./image-editor/image-editor").then((module) => ({ default: module.ImageEditor })));

const PROMPT_LIMIT = 10_000;
const VIDEO_PROMPT_LIMIT = 800;
const VIDEO_SIZES = { "16:9": "1920*1080", "9:16": "1080*1920", "1:1": "1440*1440" } as const;

function videoSize(ratio: keyof typeof VIDEO_SIZES): string {
  return VIDEO_SIZES[ratio];
}

export function GenerationPage({
  projectId,
  generationType,
  setGenerationType,
  prompt,
  setPrompt,
  referenceAsset = null,
  editAsset = null,
  onClearReference,
}: {
  projectId: string;
  generationType: "video" | "image";
  setGenerationType: (value: "video" | "image") => void;
  prompt: string;
  setPrompt: (value: string) => void;
  referenceAsset?: ReferenceAsset | null;
  editAsset?: string | null;
  onClearReference?: () => void;
}) {
  const thumbsRef = useRef<HTMLElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [videoOption, setVideoOption] = useState<Awaited<ReturnType<typeof getEditorOptions>>[number] | null>(null);
  const [imageOption, setImageOption] = useState<Awaited<ReturnType<typeof getEditorOptions>>[number] | null>(null);
  const referenceOption = generationType === "video" ? videoOption : imageOption;
  const [referenceResolution, setReferenceResolution] = useState("");
  const referenceAttempt = useRef({ inputId: crypto.randomUUID(), key: "" });
  const referenceImage = Boolean(referenceFile || referenceAsset?.category === "image");
  const hasVideoReference = generationType === "video" && referenceImage && Boolean(videoOption?.available);
  useEffect(() => {
    if (!referenceFile) { setReferenceUrl(""); return; }
    const url = URL.createObjectURL(referenceFile);
    setReferenceUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [referenceFile]);
  useEffect(() => {
    const controller = new AbortController();
    setVideoOption(null);
    setImageOption(null);
    getEditorOptions(projectId, controller.signal).then((options) => {
      if (!controller.signal.aborted) {
        setVideoOption(options.find((item) => item.capability === "image_to_video") ?? null);
        setImageOption(options.find((item) => item.capability === "image_to_image") ?? null);
      }
    }).catch(() => { if (!controller.signal.aborted) setVideoOption(null); });
    return () => controller.abort();
  }, [projectId, generationType]);
  useEffect(() => { setReferenceFile(null); setReferenceResolution(""); }, [projectId]);
  const [model, setModel] = useState<ImageModel | null>(null);
  const [pending, setPending] = useState(false);
  const [task, setTask] = useState<GenerationTask | null>(null);
  const [history, setHistory] = useState<GenerationTask[]>([]);
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(editAsset);
  useEffect(() => { if (editAsset) { setSelectedAssetId(editAsset); setGenerationType("image"); } }, [editAsset, setGenerationType]);
  useEffect(() => {
    const rail = thumbsRef.current;
    const selected = rail?.querySelector<HTMLElement>(`[data-asset-id="${selectedAssetId}"]`);
    if (rail && selected) rail.scrollTo?.({ top: selected.offsetTop - rail.offsetTop - rail.clientHeight / 2 + selected.clientHeight / 2, behavior: "smooth" });
  }, [selectedAssetId, history]);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const [resolution, setResolution] = useState<ResolutionId>("1k");
  const [ratio, setRatio] = useState<RatioId>("auto");
  const [count, setCount] = useState(1);
  const [videoDuration, setVideoDuration] = useState<5>(5);
  const promptLimit = generationType === "video" ? VIDEO_PROMPT_LIMIT : PROMPT_LIMIT;
  const [videoRatio, setVideoRatio] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [awaitingResult, setAwaitingResult] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: "success" | "danger" } | null>(null);
  const toastTimer = useRef<number | null>(null);
  const listEpoch = useRef(0);
  const imageReady = generationType === "image" && model !== null;
  const videoReady = generationType === "video" && model !== null;
  const ready = imageReady || videoReady;
  const thumbnails = history.flatMap((item) =>
    item.status === "succeeded" ? item.output_asset_ids : [],
  );
  const assetIds = selectedAssetId
    ? [selectedAssetId]
    : task?.status === "succeeded"
      ? task.output_asset_ids
      : [];

  useEffect(() => {
    const controller = new AbortController();
    const epoch = ++listEpoch.current;
    setIdempotencyKey(null);
    listImageGenerations(projectId, controller.signal, generationType)
      .then((items) => {
        if (controller.signal.aborted || epoch !== listEpoch.current) {
          return;
        }
        setHistory(items);
        const first = items.flatMap((item) =>
          item.status === "succeeded" ? item.output_asset_ids : [],
        )[0];
        setSelectedAssetId(generationType === "image" && editAsset ? editAsset : first ?? null);
        const latest = items[0] ?? null;
        setTask(latest);
        const active =
          latest?.status === "queued" ||
          latest?.status === "submitting" ||
          latest?.status === "running" ||
          latest?.status === "cancel_requested";
        setPending(active);
        setAwaitingResult(active && !editAsset);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [generationType, projectId]);

  useEffect(() => {
    const controller = new AbortController();
    setModel(null);
    getActiveImageModel(
      projectId,
      controller.signal,
      generationType === "video" ? "text_to_video" : "text_to_image",
    )
      .then((item) => {
        if (!controller.signal.aborted) {
          setModel(item);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setModel(null);
        }
      });
    return () => controller.abort();
  }, [generationType, projectId]);

  const taskId = task?.id ?? null;
  const taskStatus = task?.status ?? null;

  useEffect(() => {
    if (!task) {
      return;
    }
    setHistory((current) => {
      const index = current.findIndex((item) => item.id === task.id);
      if (index === -1) {
        return [task, ...current];
      }
      const next = current.slice();
      next[index] = task;
      return next;
    });
  }, [task]);

  useEffect(() => {
    if (pending || taskStatus !== "succeeded" || !task?.output_asset_ids[0]) {
      return;
    }
    setSelectedAssetId(task.output_asset_ids[0]);
    setAwaitingResult(false);
  }, [pending, task, taskId, taskStatus]);

  useEffect(() => {
    if (
      taskId === null ||
      taskStatus === "succeeded" ||
      taskStatus === "failed" ||
      taskStatus === "canceled"
    ) {
      return;
    }
    const activeId = taskId;
    const controller = new AbortController();
    let stopped = false;

    async function poll() {
      try {
        const next = await getImageGeneration(projectId, activeId, controller.signal);
        if (stopped) {
          return;
        }
        setTask(next);
        if (next.status === "succeeded" || next.status === "failed" || next.status === "canceled") {
          setPending(false);
          setIdempotencyKey(null);
        }
        if (next.status === "canceled") {
          setAwaitingResult(false);
        }
      } catch (pollError: unknown) {
        if (stopped || controller.signal.aborted) {
          return;
        }
        setPending(false);
        setError(userFacingMessage(pollError));
      }
    }

    void poll();
    const timer = window.setInterval(() => void poll(), 1000);
    return () => {
      stopped = true;
      controller.abort();
      window.clearInterval(timer);
    };
  }, [projectId, taskId, taskStatus]);

  function showToast(message: string, tone: "success" | "danger") {
    setToast({ message, tone });
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt);
      showToast("复制成功", "success");
    } catch {
      showToast("复制失败，请手动选择并复制内容", "danger");
    }
  }

  function clearPrompt() {
    setPrompt("");
    setIdempotencyKey(null);
  }

  async function generate() {
    const cleaned = prompt.trim();
    if (!ready || !cleaned || pending) {
      return;
    }
    if (cleaned.length > promptLimit) {
      setError(generationType === "video" ? "画面描述请控制在 800 字以内" : "画面描述请控制在 10000 字以内");
      return;
    }
    if (referenceImage && !referenceOption?.available) {
      setError(referenceOption?.reason ?? "当前模型的参考图生成能力尚未就绪，请移除参考图片或刷新后重试");
      return;
    }
    const key = idempotencyKey ?? crypto.randomUUID();
    listEpoch.current += 1;
    setIdempotencyKey(key);
    setError(null);
    setPending(true);
    setAwaitingResult(true);
    try {
      let queued: GenerationTask;
      if (referenceImage) {
        let image: Blob | null = referenceFile;
        if (!image && referenceAsset) {
          const url = new URL(referenceAsset.url, window.location.origin);
          const response = await fetch(url, { credentials: url.origin === window.location.origin ? "include" : "omit" });
          if (!response.ok) throw new Error("参考图片读取失败，请重新上传");
          image = await response.blob();
        }
        if (!image) throw new Error("请先添加参考图片");
        if (referenceAttempt.current.key !== key) referenceAttempt.current = { inputId: crypto.randomUUID(), key };
        queued = await requestImageAction(projectId, { image, prompt: cleaned, kind: generationType, resolution: referenceResolution || videoOption?.resolutions[0] || "", parameters: imageParameters(resolution, ratio, count) }, referenceAttempt.current);
      } else queued = await createImageGeneration(
        projectId,
        cleaned,
        key,
        generationType === "video"
          ? { duration: videoDuration, size: videoSize(videoRatio) }
          : imageParameters(resolution, ratio, count),
        generationType,
      );
      setTask(queued);
    } catch (generateError) {
      setPending(false);
      setAwaitingResult(false);
      setError(userFacingMessage(generateError));
    }
  }

  return (
    <main className="workspace-content generation-page">
      <div className="generation-layout">
        <section className="generation-settings">
          <div className="generation-type" aria-label="生成类型">
            <button
              className={generationType === "video" ? "active" : ""}
              aria-pressed={generationType === "video"}
              onClick={() => setGenerationType("video")}
              type="button"
            >
              <Film size={14} /> 视频生成
            </button>
            <button
              className={generationType === "image" ? "active" : ""}
              aria-pressed={generationType === "image"}
              onClick={() => setGenerationType("image")}
              type="button"
            >
              <Image size={14} /> 图片生成
            </button>
          </div>
          <div className="studio-prompt-panel">
          <div className="studio-mode-caption"><span>{generationType === "video" ? (hasVideoReference ? "图生视频" : "文生视频") : (referenceImage ? "图生图片" : "文生图片")}</span><span>{referenceImage ? (generationType === "video" ? "以参考图片作为首帧" : "结合参考图片与描述创作") : "从文字开始创作"}</span></div>
          {referenceAsset && !referenceFile ? (
            <figure className="reference-selected">
              <ReferencePreview asset={referenceAsset} />
              <figcaption>
                <strong>{referenceAsset.name}</strong>
                <span>{formatBytes(referenceAsset.size)}</span>
                <small>{hasVideoReference ? "将作为视频首帧提交给当前视频模型。" : referenceImage && imageOption?.available ? "将作为参考图提交给当前图片模型。" : referenceAsset.category === "image" ? "当前模型不支持参考图片，请移除后使用文字生成。" : referenceNote(referenceAsset.category)}</small>
              </figcaption>
              {onClearReference ? (
                <button aria-label="移除参考素材" className="reference-clear" onClick={onClearReference} type="button">
                  <X size={14} />
                </button>
              ) : null}
            </figure>
          ) : null}
          {referenceFile && <figure className="reference-selected"><img src={referenceUrl} alt="生成参考图片" /><figcaption><strong>{referenceFile.name}</strong><span>{formatBytes(referenceFile.size)}</span><small>{generationType === "video" ? "作为首帧生成视频" : "结合参考图生成图片"}</small></figcaption><button type="button" disabled={pending} aria-label="移除上传图片" onClick={() => { setReferenceFile(null); setIdempotencyKey(null); }}><X size={14} /></button></figure>}
          <input ref={uploadRef} className="sr-only" aria-label={generationType === "video" ? "上传视频参考图片" : "上传图片参考图片"} type="file" accept="image/png,image/jpeg,image/webp" disabled={pending || !referenceOption?.available} onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            if (!["image/png", "image/jpeg", "image/webp"].includes(file.type) || file.size > 80 * 1024 * 1024) { setError("请上传不超过 80 MB 的 PNG、JPEG 或 WebP 图片"); return; }
            setReferenceFile(file); setIdempotencyKey(null); setError(null); onClearReference?.();
          }} />
          <button className="reference-upload" disabled={pending || !referenceOption?.available} onClick={() => uploadRef.current?.click()} type="button">
            <Plus size={16} /><span>{referenceFile ? "更换参考图片" : "添加参考图片"}</span>
            <small>{referenceOption?.available ? `PNG / JPG / WebP · ${generationType === "video" ? "首帧" : "参考图"}` : referenceOption?.reason || "正在检查参考图片能力"}</small>
          </button>
          <label className="generation-label" htmlFor="generation-prompt">
            画面描述 <span>你的想法，越具体越好</span>
          </label>
          <textarea
            id="generation-prompt"
            maxLength={promptLimit}
            value={prompt}
            onChange={(event) => {
              setPrompt(event.target.value);
              setIdempotencyKey(null);
            }}
            placeholder={
              generationType === "video"
                ? "描述主体、动作、镜头运动、场景与氛围…"
                : "描述主体、构图、色彩、光线与视觉风格…"
            }
          />
          <div className="generation-prompt-actions">
            <span>{prompt.length} / {promptLimit.toLocaleString()}</span>
            <div className="generation-prompt-tools">
              <Button
                aria-label="清空画面描述"
                disabled={!prompt}
                onClick={clearPrompt}
                type="button"
                variant="ghost"
              >
                <Trash2 size={16} />
              </Button>
              <Button variant="ghost" disabled={!prompt.trim()} onClick={() => void copyPrompt()}>
                <Copy size={13} /> 复制提示词
              </Button>
            </div>
          </div>
          <div className="studio-prompt-helper"><Button variant="ghost" disabled={Boolean(prompt)} title={prompt ? "清空描述后可填入示例" : "填入示例，不会自动生成"} onClick={() => { setPrompt(generationType === "video" ? "一位旅人走过薄雾中的森林，镜头缓缓向前推进。清晨的阳光穿过树冠，叶片轻轻摇动，电影质感，安静而充满探索感。" : "薄雾笼罩的森林，一位旅人站在远处的小径上。清晨柔和的光线穿过树冠，广角构图，细腻的胶片质感，自然的绿色与暖金色。" ); setIdempotencyKey(null); }}><Sparkles size={14} /> 试用示例</Button><span>主体 · 场景 · 光线 · {generationType === "video" ? "运镜" : "构图"}</span></div>
          </div>
          <div className="generation-actions">
          <div className="studio-parameter-heading">生成设置<span>{generationType === "video" ? "时长与画幅" : "画质与数量"}</span></div>
          {imageReady ? (
            <ImageSettingsMenu
              count={count}
              onCount={(value) => {
                setCount(value);
                setIdempotencyKey(null);
              }}
              onRatio={(value) => {
                setRatio(value);
                setIdempotencyKey(null);
              }}
              onResolution={(value) => {
                setResolution(value);
                setIdempotencyKey(null);
              }}
              ratio={ratio}
              resolution={resolution}
            />
          ) : null}
          {videoReady ? (
            <div className="generation-video-options">
              <div className="studio-option-row"><span>时长</span><div role="group" aria-label="视频时长">
                {([5] as const).map((seconds) => (
                  <button
                    aria-pressed={videoDuration === seconds}
                    key={seconds}
                    onClick={() => {
                      setVideoDuration(seconds);
                      setIdempotencyKey(null);
                    }}
                    type="button"
                  >
                    {seconds} 秒
                  </button>
                ))}
              </div>
              </div><div className="studio-option-row"><span>{hasVideoReference ? "清晰度" : "画幅"}</span>{hasVideoReference ? <div role="group" aria-label="图生视频清晰度">{videoOption?.resolutions.map((value) => <button key={value} type="button" aria-pressed={(referenceResolution || videoOption.resolutions[0]) === value} onClick={() => { setReferenceResolution(value); setIdempotencyKey(null); }}>{value}</button>)}<small>画幅跟随首帧</small></div> : <div role="group" aria-label="视频画幅">
                {(["16:9", "9:16", "1:1"] as const).map((item) => (
                  <button
                    aria-pressed={videoRatio === item}
                    key={item}
                    onClick={() => {
                      setVideoRatio(item);
                      setIdempotencyKey(null);
                    }}
                    type="button"
                  >
                    {item}
                  </button>
                ))}
              </div>}
            </div></div>
          ) : null}
          {!ready && <p className="studio-unavailable">当前类型暂无可用模型，请联系管理员配置。</p>}
          <Button
            className="generate-button"
            disabled={!ready || !prompt.trim() || pending || (hasVideoReference && !videoOption?.available)}
            onClick={() => void generate()}
          >
            <WandSparkles size={14} />
            {ready
              ? pending
                ? generationType === "video"
                  ? "正在生成视频"
                  : "正在生成图片"
                : generationType === "video"
                  ? "生成视频"
                  : "生成图片"
              : `${generationType === "video" ? "生成视频" : "生成图片"} · 暂未开放`}
          </Button>
          {generationType === "image" && <OutpaintDebugLink projectId={projectId} taskId={history.find(item => item.output_asset_ids.includes(assetIds[0]!))?.id ?? task?.id} />}
          {generationType === "video" && <RecentEdits projectId={projectId} />}
          <p className="studio-submit-note">内容由 AI 生成 · 结果保存在当前项目</p>
          </div>
          {error ? (
            <p className="generation-copy-status" role="alert">
              {error}
            </p>
          ) : null}
          {toast ? (
            <p className="generation-toast" data-tone={toast.tone} role="status">
              {toast.tone === "success" ? <Check aria-hidden size={16} /> : null}
              {toast.message}
            </p>
          ) : null}
        </section>
        <section className="generation-preview" aria-label="生成预览">
          <div className="generation-preview-center">
            {pending || (awaitingResult && taskStatus !== "failed") ? (
              <GenerationLoadingCard
                aspectRatio={generationType === "video" ? videoRatio : generationAspectRatio(ratio)}
                status="generating"
                subtitle={generationType === "video" ? "正在生成视频" : "正在生成图像"}
              />
            ) : awaitingResult && taskStatus === "failed" ? (
              <GenerationLoadingCard
                aspectRatio={generationType === "video" ? videoRatio : generationAspectRatio(ratio)}
                status="failed"
                onRetry={() => void generate()}
              />
            ) : assetIds[0] && generationType === "video" ? (
              <div className="generation-video-frame">
                <VideoPlayer key={assetIds[0]} src={assetContentPath(projectId, assetIds[0])}
                  prompt={history.find(item => item.output_asset_ids.includes(assetIds[0]!))?.prompt ?? (task?.output_asset_ids.includes(assetIds[0]!) ? task.prompt : undefined)}
                  actions={<EditVideoButton projectId={projectId} assetId={assetIds[0]} />} />
              </div>
            ) : assetIds[0] ? (
              <Suspense fallback={null}>
                <ImageEditor key={`${projectId}:${assetIds[0]}`} projectId={projectId} originalPrompt={history.find((item) => item.output_asset_ids.includes(assetIds[0]!))?.prompt ?? ""} src={assetContentPath(projectId, assetIds[0])} onResult={(result, apply = true) => {
                  if (result.kind !== generationType) setGenerationType(result.kind);
                  setTask(result);
                  setPending(!["succeeded", "failed", "canceled"].includes(result.status));
                  setAwaitingResult(!["succeeded", "canceled"].includes(result.status));
                  if (apply) setSelectedAssetId(result.output_asset_ids[0] ?? null);
                  setHistory(current => [result, ...current.filter(item => item.id !== result.id)]);
                }} />
              </Suspense>
            ) : (
              <>
                <div className="preview-frame">
                  <LumiMark width={53} height={53} />
                </div>
                <h2>和 {brand.name} 一起开始创作</h2>
                <p>
                  在左侧写下你的想法，
                  <br />
                  生成的作品将在这里呈现。
                </p>
              </>
            )}
          </div>
        </section>
        <WorksPanel onRegenerate={(item) => { setPrompt(item.prompt); setIdempotencyKey(null); setToast({ message: "已填入原作品提示词，请确认生成设置后点击生成。", tone: "success" }); }} projectId={projectId} kind={generationType} history={history} onSelect={(id, items) => { setHistory(items); setAwaitingResult(false); setSelectedAssetId(id); }} onDelete={(ids) => { setHistory(current => current.map(item => ({ ...item, output_asset_ids: item.output_asset_ids.filter(id => !ids.includes(id)) }))); setSelectedAssetId(current => current && ids.includes(current) ? null : current); setTask(current => current ? { ...current, output_asset_ids: current.output_asset_ids.filter(id => !ids.includes(id)) } : current); }} />
        <aside ref={thumbsRef} aria-label="生成结果" className="generation-thumbs">
          <span className="studio-history-label">本项目作品 <small>{generationType === "video" ? "视频" : "图片"}</small></span>
          {deleteTarget ? (
            <AlertDialog open onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null); }}>
            <AlertDialogContent className="work-delete-dialog">
              <AlertDialogTitle className="work-delete-title">删除这个作品？</AlertDialogTitle>
              <AlertDialogDescription className="work-delete-description">删除后，作品将从列表中移除。云端文件按管理员设置的策略保留或清理。</AlertDialogDescription>
              <div className="work-delete-actions">
              <Button variant="outline" disabled={deleting} onClick={() => setDeleteTarget(null)} type="button">取消</Button>
              <Button variant="danger"
                disabled={deleting}
                onClick={() => {
                  const assetId = deleteTarget;
                  setDeleting(true);
                  void deleteWork(projectId, assetId)
                    .then((result) => {
                      setHistory((current) => current.map((item) => ({
                        ...item,
                        output_asset_ids: item.output_asset_ids.filter((id) => id !== assetId),
                      })));
                      setSelectedAssetId((current) => current === assetId ? null : current);
                      setTask((current) => current ? { ...current, output_asset_ids: current.output_asset_ids.filter((id) => id !== assetId) } : current);
                      setToast({ message: deletionMessage(result), tone: result.purge_status === "failed" ? "danger" : "success" });
                      setDeleteTarget(null);
                    })
                    .catch((reason) => setToast({ message: userFacingMessage(reason), tone: "danger" }))
                    .finally(() => setDeleting(false));
                }}
                type="button"
              >
                {deleting ? "正在删除…" : "确认删除"}
              </Button>
              </div>
            </AlertDialogContent>
            </AlertDialog>
          ) : null}
          {thumbnails.length === 0 && <span className="studio-history-empty">完成生成后，可在此切换查看作品</span> }
          {thumbnails.map((assetId) => (
            <div className="studio-thumb-item" data-asset-id={assetId} key={assetId}>
            <button
              aria-label={generationType === "video" ? "查看这条生成结果" : "查看这张生成结果"}
              aria-pressed={assetId === selectedAssetId}
              onClick={() => {
                if (pending) {
                  return;
                }
                setAwaitingResult(false);
                setSelectedAssetId(assetId);
              }}
              type="button"
            >
              {generationType === "video" ? (
                <video muted playsInline preload="metadata" src={assetContentPath(projectId, assetId)} />
              ) : (
                <img alt="" src={assetContentPath(projectId, assetId)} />
              )}
            </button>
            <button className="studio-thumb-delete" aria-label="删除这件作品" title="删除作品" disabled={deleting} onClick={() => setDeleteTarget(assetId)} type="button"><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}

function ReferencePreview({ asset }: { asset: ReferenceAsset }) {
  const [broken, setBroken] = useState(false);
  if (broken || asset.category === "file") {
    return <span className="reference-file">文件</span>;
  }
  if (asset.category === "video") {
    return <video muted onError={() => setBroken(true)} playsInline preload="metadata" src={asset.url} />;
  }
  return <img alt="" onError={() => setBroken(true)} src={asset.url} />;
}

function referenceNote(category: ReferenceAsset["category"]): string {
  if (category === "video") {
    return "已带入参考区。当前生成按文字描述提交，不会把视频发给模型。";
  }
  if (category === "image") {
    return "已带入参考区。当前生成按文字描述提交，不会把图片发给模型。";
  }
  return "已带入参考区。当前生成按文字描述提交。";
}

