import { Check, ArrowUpRight, ScanLine } from "lucide-react";
import { ImageComparison } from "./image-comparison";
import { brand } from "../../../../brand";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../../../components/ui/dialog";
import { Button } from "../../../../components/ui/button";
import { isApiError, apiRequest } from "../../../../lib/api";
import {
  assetContentPath,
  getImageGeneration,
  type GenerationTask,
} from "../../image-generation";
import { getEditorOptions, requestImageAction } from "../../image-edit";

export type ImageAction = {
  selection?: { x: number; y: number; width: number; height: number };
  image: Blob;
  mask?: Blob;
  prompt: string;
  kind: "image" | "video";
};

export function GenerationAction({
  projectId,
  input,
  onClose,
  onResult,
}: {
  projectId: string;
  input: ImageAction;
  onClose: () => void;
  onResult: (task: GenerationTask, apply?: boolean) => void;
}) {
  const [preview, setPreview] = useState("");
  const [prompt, setPrompt] = useState(input.prompt);
  const [resolution, setResolution] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const attempt = useRef({
    inputId: crypto.randomUUID(),
    key: crypto.randomUUID(),
  });
  const signature = useRef<string | null>(null);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const url = URL.createObjectURL(input.image);
    setPreview(url);
    const active = new AbortController();
    controller.current = active;
    return () => {
      URL.revokeObjectURL(url);
      active.abort();
    };
  }, [input.image]);
  const options = useQuery({
    queryKey: ["image-editor-options", projectId],
    refetchOnMount: "always",
    queryFn: ({ signal }) => getEditorOptions(projectId, signal),
  });
  const capability =
    input.kind === "video" ? "image_to_video" : "image_inpaint";
  const option = options.data?.find((item) => item.capability === capability);
  const selectedResolution = resolution || option?.resolutions[0] || "";
  const create = useMutation({
    mutationFn: async () => {
      const values = {
        prompt: prompt.trim(),
        resolution: selectedResolution,
      };
      const next = `${values.prompt}\n${values.resolution}\n${input.kind}`;
      if (signature.current !== null && signature.current !== next) {
        attempt.current = { inputId: crypto.randomUUID(), key: crypto.randomUUID() };
      }
      signature.current = next;
      return requestImageAction(
        projectId,
        { ...input, prompt: values.prompt, resolution: values.resolution },
        attempt.current,
        controller.current.signal,
      );
    },
    onSuccess: (task) => {
      if (!controller.current.signal.aborted) setTaskId(task.id);
    },
  });
  const task = useQuery({
    queryKey: ["image-action-task", projectId, taskId],
    enabled: taskId !== null,
    queryFn: ({ signal }) => getImageGeneration(projectId, taskId!, signal),
    refetchInterval: (query) =>
      ["succeeded", "failed", "canceled"].includes(
        query.state.data?.status ?? "",
      )
        ? false
        : 2000,
    refetchIntervalInBackground: false,
  });
  const cancel = useMutation({
    mutationFn: () =>
      apiRequest({
        path: `/api/v1/projects/${projectId}/generation-tasks/${taskId}/cancel`,
        method: "POST",
        csrf: true,
      }),
    onSuccess: () => {
      void task.refetch();
    },
  });
  const validationError = input.image.size > 80 * 1024 * 1024
    ? "当前画布导出后超过 80 MB，请关闭弹窗，缩小图片尺寸后重新提交。"
    : input.mask && input.mask.size > 80 * 1024 * 1024
      ? "选区蒙版超过 80 MB，请缩小图片尺寸后重新提交。"
        : input.kind === "image" && !input.mask
        ? "缺少重绘选区，请关闭弹窗并重新框选需要修改的区域。"
        : null;
  const error = create.error ?? task.error ?? cancel.error;
  const result = task.data;
  const output = result?.output_asset_ids[0];
  function close() {
    onClose();
  }
  const locked = create.isPending || taskId !== null;
  const labels: Record<string, string> = {
    queued: "排队中",
    submitting: "正在提交",
    running: `${brand.name} 正在将灵感化为画面`,
    succeeded: "生成完成",
    failed: "生成失败",
    canceled: "已取消",
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !create.isPending) close();
      }}
    >
      <DialogContent className="image-action-dialog">
        <div className="image-action-scroll">
        <div className="image-action-heading"><span className="image-action-eyebrow"><ScanLine size={13} /> LUMI EDIT</span>
          <DialogTitle>
            {input.kind === "video" ? "让这张图片动起来" : "局部重绘"}
          </DialogTitle>
          <DialogDescription>
            {input.kind === "video"
              ? "以当前画布作为首帧，描述主体动作与镜头运动。"
              : "只替换选区内的内容。原图会保留，新图片保存到当前项目。"}
          </DialogDescription>
        </div>
        {output && input.kind === "image" ? (
          <ImageComparison original={preview} result={assetContentPath(projectId, output)} />
        ) : output && input.kind === "video" ? (
          <video controls playsInline src={assetContentPath(projectId, output)} />
        ) : preview ? (
          <div className="inpaint-reference">
            <img alt="本次生成的参考图片" src={preview} />
            {input.selection && <div className="inpaint-selection" aria-label="本次重绘选区" style={{
              left: `${input.selection.x * 100}%`, top: `${input.selection.y * 100}%`,
              width: `${input.selection.width * 100}%`, height: `${input.selection.height * 100}%`,
            }}><span>修改区域</span></div>}
          </div>
        ) : null}
        {result?.status === "succeeded" && output ? (
          <div className="image-action-summary"><span>创作描述</span><p>{prompt}</p></div>
        ) : <label>
          创作描述
          <textarea
            aria-label="创作描述"
            disabled={locked}
            value={prompt}
            maxLength={800}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder={
              input.kind === "video"
                ? "例如：镜头缓缓推进，风吹动人物的头发，自然光影流动"
                : "描述希望在选中区域出现的内容"
            }
          />
        </label>}
        {options.isPending ? (
          <p role="status">正在读取模型配置…</p>
        ) : options.isError ? (
          <Button onClick={() => void options.refetch()}>重试加载模型</Button>
        ) : !option?.available ? (
          <p className="image-action-model">{option?.reason ?? "此能力暂不可用"}</p>
        ) : input.kind === "video" ? (
          <p className="image-action-model">统一视频模型 · {option.model_name}</p>
        ) : null}
        {input.kind === "video" && option?.available && (
          <div className="image-action-settings">
            <label>
              清晰度
              <select
                aria-label="视频清晰度"
                disabled={locked}
                value={selectedResolution}
                onChange={(event) => setResolution(event.target.value)}
              >
                {option.resolutions.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <span>{option.duration} 秒 · 比例跟随首帧</span>
          </div>
        )}
        {result && (
          <p
            className={result.status === "failed" ? "image-action-failure" : "image-action-status"}
            role="status"
          >
            <span className="image-action-status-label">{result.status === "succeeded" && <Check size={14} />}{labels[result.status] ?? result.status}</span>
            {result.error ? <span>{result.error.message}</span> : null}
          </p>
        )}
        {(validationError || error) && (
          <p role="alert">
            {validationError ?? (isApiError(error) || error instanceof Error ? error.message : "操作未完成，请重试")}
          </p>
        )}
        {!validationError && !options.isPending && !options.isError && option?.available && !prompt.trim() && (
          <p className="image-action-model">请先填写创作描述</p>
        )}
        {create.isError && !taskId && (
          <p>
            内容没变时，重试会使用相同请求标识，避免重复生成。修改描述后会作为一次新的提交。
          </p>
        )}
        </div>
        <div className="image-action-buttons">
          {result?.status === "failed" && <Button onClick={() => {
            setTaskId(null);
            create.reset();
            attempt.current = { inputId: crypto.randomUUID(), key: crypto.randomUUID() };
            signature.current = null;
          }}>修改描述后重新生成</Button>}
          {!taskId && (
            <Button
              disabled={
                !!validationError || !option?.available || !prompt.trim() || create.isPending
              }
              onClick={() => create.mutate()}
            >
              {create.isPending
                ? "正在提交…"
                : create.isError
                  ? "重试本次提交"
                  : "确认生成"}
            </Button>
          )}
          {result?.allowed_actions.includes("cancel") && (
            <Button disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              取消排队
            </Button>
          )}
          {result?.status === "succeeded" && output && input.kind === "image" ? (
            <>
              <Button onClick={() => onResult(result, true)}>使用结果 <ArrowUpRight size={15} /></Button>
              <Button onClick={() => onResult(result, true)} variant="outline">继续调整</Button>
              <Button onClick={() => onResult(result, false)} variant="ghost">保留原图</Button>
            </>
          ) : null}
          {result?.status === "succeeded" && output && input.kind === "video" ? (
            <Button onClick={() => onResult(result, true)}>查看视频作品</Button>
          ) : null}
          <Button
            variant="ghost"
            className="image-action-close"
            disabled={create.isPending}
            onClick={close}
          >
            {taskId && !output ? "关闭，稍后在生成记录查看" : "关闭"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
