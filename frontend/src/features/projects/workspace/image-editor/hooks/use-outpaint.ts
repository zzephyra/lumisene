import { useEffect, useRef, useState } from "react";
import { getEditorOptions, requestImageAction } from "../../../image-edit";
import {
  getImageGeneration,
  type GenerationTask,
} from "../../../image-generation";
import type { EditorDocument, OutpaintFrame } from "../types";
import { isApiError, userFacingMessage } from "../../../../../lib/api";
import { exportOutpaint } from "../utils/export-outpaint";
import {
  calculateAspectRatioExtension,
  calculateTargetSize,
  clampExtension,
  emptyExtension,
  fromFrame,
  outpaintMetadata,
  toFrame,
  type Extension,
  type OutpaintLimits,
} from "../utils/outpaint";

export function useOutpaint(
  projectId: string,
  src: string,
  document: EditorDocument | null,
  originalPrompt: string,
  onResult: (task: GenerationTask) => void,
) {
  const [extension, setExtension] = useState<Extension>(emptyExtension);
  const [prompt, setPrompt] = useState(originalPrompt.slice(0, 800));
  const [phase, setPhase] = useState("");
  const [percent, setPercent] = useState(20);
  const [ratio, setRatio] = useState<number | null>(null);
  const [option, setOption] = useState<
    Awaited<ReturnType<typeof getEditorOptions>>[number] | null
  >(null);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState("");
  const [pollId, setPollId] = useState<string | null>(null);
  const mutex = useRef(false);
  const attempt = useRef<{
    inputId: string;
    key: string;
    signature: string;
  } | null>(null);
  const controller = useRef(new AbortController());
  const callback = useRef(onResult);
  callback.current = onResult;
  const limits = option?.limits as OutpaintLimits | undefined;
  const width = document?.width ?? 1,
    height = document?.height ?? 1;
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setExtension(emptyExtension());
    setPending(false);
    mutex.current = false;
    setPollId(null);
    setError(null);
    setPrompt(originalPrompt.slice(0, 800));
    setOption(null);
    setLoadingOptions(true);
    attempt.current = null;
    getEditorOptions(projectId, abort.signal)
      .then((options) => {
        if (!abort.signal.aborted)
          setOption(
            options.find((item) => item.capability === "image_outpaint") ?? null,
          );
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setError("无法读取图片模型配置，请重新打开图片后重试");
      })
      .finally(() => {
        if (!abort.signal.aborted) setLoadingOptions(false);
      });
    return () => abort.abort();
  }, [originalPrompt, projectId, src]);
  function change(value: Extension) {
    if (mutex.current || !limits) return extension;
    const clamped = clampExtension(width, height, value, limits);
    const asked = calculateTargetSize(width, height, {
      top: Math.max(0, Math.round(value.top)),
      right: Math.max(0, Math.round(value.right)),
      bottom: Math.max(0, Math.round(value.bottom)),
      left: Math.max(0, Math.round(value.left)),
    });
    const got = calculateTargetSize(width, height, clamped);
    const exceededSideLimit =
      value.left > width ||
      value.right > width ||
      value.top > height ||
      value.bottom > height;
    setHint(
      exceededSideLimit
        ? "每侧最多扩展原图对应宽度或高度的 100%"
        : got.width < asked.width || got.height < asked.height
        ? `当前模型最大支持 ${limits.max_width} × ${limits.max_height}`
        : "",
    );
    setExtension(clamped);
    setError(null);
    attempt.current = null;
    return clamped;
  }
  function reset() {
    setRatio(null);
    change({
      left: Math.round(width * 0.2),
      right: Math.round(width * 0.2),
      top: Math.round(height * 0.2),
      bottom: Math.round(height * 0.2),
    });
  }
  function quick(direction: keyof Extension | "all") {
    setRatio(null);
    const e = emptyExtension();
    if (direction === "all" || direction === "left")
      e.left = Math.round((width * percent) / 100);
    if (direction === "all" || direction === "right")
      e.right = Math.round((width * percent) / 100);
    if (direction === "all" || direction === "top")
      e.top = Math.round((height * percent) / 100);
    if (direction === "all" || direction === "bottom")
      e.bottom = Math.round((height * percent) / 100);
    change(e);
  }
  function chooseRatio(value: number | null) {
    setRatio(value);
    if (value) change(calculateAspectRatioExtension(width, height, value));
  }
  useEffect(() => {
    if (!pollId) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const task = await getImageGeneration(projectId, pollId!, abort.signal);
        if (abort.signal.aborted) return;
        if (task.status === "succeeded") {
          mutex.current = false;
          setPending(false);
          setPollId(null);
          setExtension(emptyExtension());
          callback.current(task);
          return;
        }
        if (["failed", "canceled"].includes(task.status)) {
          mutex.current = false;
          setPending(false);
          setPollId(null);
          attempt.current = null;
          setError(
            `扩图失败，请重试${task.error?.message ? `：${task.error.message}` : ""}`,
          );
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch {
        if (!abort.signal.aborted) {
          setError("暂时无法读取任务进度，正在重新连接…");
          timer = setTimeout(() => void poll(), 4000);
        }
      }
    }
    void poll();
    return () => {
      abort.abort();
      clearTimeout(timer);
    };
  }, [pollId, projectId]);
  async function generate() {
    if (mutex.current || !document || !limits || !option?.available) return;
    if (!Object.values(extension).some(Boolean)) {
      setError("请先扩大画布范围"); return;
    }
    const description =
      prompt.trim() ||
      originalPrompt.trim().slice(0, 800) ||
      "自然延展图像，保持原图主体、构图、风格、光线和颜色连续";
    const signature = JSON.stringify({ extension, description });
    if (attempt.current?.signature !== signature)
      attempt.current = {
        inputId: crypto.randomUUID(),
        key: crypto.randomUUID(),
        signature,
      };
    const active = controller.current;
    mutex.current = true;
    setPending(true);
    setPhase("正在上传原图…");
    setError(null);
    try {
      const exported = await exportOutpaint(
        document,
        toFrame(width, height, extension),
      );
      if (active.signal.aborted) return;
      const metadata = {...outpaintMetadata(exported.width, exported.height, exported.extension), best_quality: false};
      setPhase("万相 2.1 正在扩展画面…");
      const task = await requestImageAction(
        projectId,
        {
          ...exported,
          prompt: description,
          kind: "image",
          resolution: "",
          outpaint: metadata,
        },
        attempt.current,
        active.signal,
      );
      if (!active.signal.aborted) setPollId(task.id);
    } catch (error) {
      if (!active.signal.aborted) {
        mutex.current = false;
        setPending(false);
        const message =
          isApiError(error) &&
          (error.code === "validation_error" || error.code === "domain_error")
            ? error.message
            : userFacingMessage(error);
        setError(`扩图失败，请重试：${message}`);
      }
    }
  }
  return {
    phase,
    frame: toFrame(width, height, extension),
    extension,
    prompt,
    setPrompt,
    percent,
    setPercent,
    ratio,
    chooseRatio,
    reset,
    quick,
    pending,
    error,
    hint,
    generate,
    available: Boolean(option?.available && limits),
    loadingOptions,
    reason: option?.reason,
    setFrame: (frame: OutpaintFrame) => {
      setRatio(null);
      return toFrame(width, height, change(fromFrame(width, height, frame)));
    },
  };
}
