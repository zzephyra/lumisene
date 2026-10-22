import { useEffect, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { uploadFile } from "../uploads";
import type { Story } from "./api";
import { StoryCover } from "./story-cover";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export function StoryDialog({
  open,
  story,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  story: Story | null;
  pending: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (value: {
    title: string;
    description: string;
    cover_upload_id: string | null;
  }) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverId, setCoverId] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [localError, setLocalError] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(story?.title ?? "");
    setDescription(story?.description ?? "");
    setCoverId(story?.cover_upload_id ?? null);
    setCoverUrl(story?.cover_url ?? null);
    setLocalError("");
  }, [open, story]);

  async function choose(file: File | undefined) {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    const allowedExtension =
      extension === "jpg" ||
      extension === "jpeg" ||
      extension === "png" ||
      extension === "webp";
    if ((!file.type || !IMAGE_TYPES.has(file.type)) && !allowedExtension) {
      setLocalError("封面仅支持 JPG、PNG、WebP");
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      setLocalError("封面不能超过 20 MB");
      return;
    }
    setUploading(true);
    setLocalError("");
    const preview = URL.createObjectURL(file);
    setCoverUrl(preview);
    try {
      const saved = await uploadFile(file, { category: "image" });
      setCoverId(saved.id);
      setCoverUrl(saved.url);
    } catch (reason) {
      setCoverId(story?.cover_upload_id ?? null);
      setCoverUrl(story?.cover_url ?? null);
      setLocalError(reason instanceof Error ? reason.message : "封面上传失败");
    } finally {
      URL.revokeObjectURL(preview);
      setUploading(false);
    }
  }

  function submit() {
    const name = title.trim();
    if (!name) {
      setLocalError("请填写故事名称");
      return;
    }
    if (name.length > 120) {
      setLocalError("故事名称不能超过 120 个字符");
      return;
    }
    if (description.length > 4000) {
      setLocalError("故事介绍不能超过 4000 个字符");
      return;
    }
    setLocalError("");
    onSubmit({
      title: name,
      description: description.trim(),
      cover_upload_id: coverId,
    });
  }

  const message = localError || error;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending && !uploading) onClose();
      }}
    >
      <DialogContent
        className="max-w-lg"
        aria-describedby="story-form-description"
      >
        <DialogTitle>{story ? "编辑故事" : "新建故事"}</DialogTitle>
        <DialogDescription id="story-form-description">
          名称必填，介绍和封面可以稍后补充。
        </DialogDescription>
        <div className="mt-5 overflow-hidden rounded-lg border border-line">
          <StoryCover key={coverUrl ?? "empty"} url={coverUrl} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <label className="inline-flex h-10 cursor-pointer items-center rounded-full border border-line px-4 text-sm">
            {uploading
              ? "正在上传封面…"
              : coverId || coverUrl
                ? "更换封面"
                : "上传封面"}
            <input
              aria-label="上传封面"
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
              disabled={pending || uploading}
              onChange={(event) => {
                void choose(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
          </label>
          {(coverId || coverUrl) && (
            <Button
              variant="outline"
              disabled={pending || uploading}
              onClick={() => {
                setCoverId(null);
                setCoverUrl(null);
              }}
            >
              移除封面
            </Button>
          )}
        </div>
        <label className="mt-4 block text-sm text-muted">
          故事名称
          <Input
            className="mt-2"
            maxLength={120}
            required
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="mt-4 block text-sm text-muted">
          故事介绍
          <Textarea
            className="mt-2"
            maxLength={4000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </label>
        {message && (
          <p className="mt-3 text-sm text-danger" role="alert">
            {message}
          </p>
        )}
        <div className="mt-6 flex justify-end gap-3">
          <Button
            variant="outline"
            disabled={pending || uploading}
            onClick={onClose}
          >
            取消
          </Button>
          <Button disabled={pending || uploading} onClick={submit}>
            {pending ? "正在保存…" : story ? "保存" : "创建"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
