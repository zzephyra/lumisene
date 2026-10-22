import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { isApiError } from "../../lib/api";
import { uploadFile } from "../uploads/upload-file";
import type { UploadCategory, UploadLimits } from "../uploads/types";
import { attachResource, type LibraryOptions, type LinkCategory } from "./api";

const KNOWN: Record<string, { category: UploadCategory; mime: string }> = {
  jpg: { category: "image", mime: "image/jpeg" },
  jpeg: { category: "image", mime: "image/jpeg" },
  png: { category: "image", mime: "image/png" },
  webp: { category: "image", mime: "image/webp" },
  gif: { category: "image", mime: "image/gif" },
  mp4: { category: "video", mime: "video/mp4" },
  webm: { category: "video", mime: "video/webm" },
  mov: { category: "video", mime: "video/quicktime" },
  pdf: { category: "file", mime: "application/pdf" },
  txt: { category: "file", mime: "text/plain" },
  md: { category: "file", mime: "text/markdown" },
  markdown: { category: "file", mime: "text/markdown" },
};

type Row = {
  key: string;
  file: File;
  status: "queued" | "uploading" | "done" | "error";
  detail: string;
};

export function AssetUploadDialog({
  open,
  projectId,
  storyId,
  options,
  session,
  initialFiles,
  onClose,
}: {
  open: boolean;
  projectId: string;
  storyId: string;
  options: LibraryOptions | undefined;
  session: number;
  initialFiles: File[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState<LinkCategory>("general");
  const [rows, setRows] = useState<Row[]>([]);
  const [notice, setNotice] = useState("");
  const limits = options?.limits;

  useEffect(() => {
    if (!open) return;
    setNotice("");
    setCategory("general");
    setRows(initialFiles.map(row));
  }, [open, session, initialFiles]);

  function add(files: File[]) {
    setRows((current) => [...current, ...files.map(row)]);
  }

  async function start(target?: Row) {
    if (!limits) {
      setNotice("还没有读到上传限制，请稍后重试");
      return;
    }
    const pending = rows.filter((item) => (target ? item.key === target.key : item.status === "queued" || item.status === "error"));
    for (const item of pending) {
      const prepared = prepare(item.file, limits);
      if ("error" in prepared) {
        update(item.key, { status: "error", detail: prepared.error });
        continue;
      }
      update(item.key, { status: "uploading", detail: "正在上传" });
      try {
        const saved = await uploadFile(prepared.file, { category: prepared.category });
        await attachResource(projectId, storyId, {
          upload_id: saved.id,
          name: item.file.name,
          category,
        });
        update(item.key, { status: "done", detail: "已加入剧本" });
        await queryClient.invalidateQueries({
          queryKey: ["projects", projectId, "stories", storyId, "resources"],
        });
      } catch (error) {
        update(item.key, { status: "error", detail: reason(error) });
      }
    }
  }

  function update(key: string, patch: Partial<Row>) {
    setRows((current) => current.map((item) => (item.key === key ? { ...item, ...patch } : item)));
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogTitle>添加资源</DialogTitle>
        <DialogDescription>上传后会立即保存到当前剧本。人物形象仍在人物关系中管理。</DialogDescription>
        <div className="story-asset-dialog">
          <label className="grid gap-2 text-sm">
            归入分类
            <select
              className="story-asset-field"
              value={category}
              onChange={(event) => setCategory(event.target.value as LinkCategory)}
            >
              <option value="general">一般</option>
              <option value="scene">场景</option>
              <option value="shot">分镜</option>
            </select>
          </label>
          <button
            type="button"
            className="story-asset-dropzone"
            onClick={() => input.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              add([...(event.dataTransfer.files ?? [])]);
            }}
          >
            <span>
              <strong>选择文件</strong>
              <br />
              或拖到这里。支持 JPEG、PNG、WebP、GIF、MP4、WebM、MOV、PDF、TXT、Markdown。
              <br />
              {limits
                ? `图片 ${size(limits.image)}，视频 ${size(limits.video)}，文档 ${size(limits.file)}。`
                : "正在读取大小限制…"}
            </span>
          </button>
          <input
            ref={input}
            hidden
            multiple
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,.pdf,.txt,.md,.markdown"
            onChange={(event) => {
              add([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          {notice && <p role="alert">{notice}</p>}
          {rows.length > 0 && (
            <ul className="story-asset-files">
              {rows.map((item) => (
                <li key={item.key} className="story-asset-file" data-state={item.status}>
                  <span title={item.file.name}>{item.file.name}</span>
                  <em>
                    {item.detail}
                    {item.status === "error" && (
                      <button type="button" className="ml-2 underline" onClick={() => void start(item)}>
                        重试
                      </button>
                    )}
                  </em>
                </li>
              ))}
            </ul>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              关闭
            </Button>
            <Button disabled={!rows.some((item) => item.status === "queued" || item.status === "error")} onClick={() => void start()}>
              开始上传
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function row(file: File): Row {
  return { key: `${file.name}-${file.size}-${file.lastModified}-${Math.random()}`, file, status: "queued", detail: size(file.size) };
}

function prepare(file: File, limits: UploadLimits): { file: File; category: UploadCategory } | { error: string } {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const known = KNOWN[ext];
  if (!known) return { error: "格式不支持" };
  const declared = file.type.toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== known.mime) {
    return { error: "文件扩展名与类型不一致" };
  }
  const limit = limits[known.category];
  if (file.size <= 0) return { error: "文件是空的" };
  if (file.size > limit) return { error: `超过 ${size(limit)} 限制` };
  const typed =
    file.type === known.mime
      ? file
      : new File([file], file.name, { type: known.mime, lastModified: file.lastModified });
  return { file: typed, category: known.category };
}

function size(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function reason(error: unknown) {
  if (isApiError(error) && error.message) return error.message;
  return error instanceof Error ? error.message : "上传失败";
}
