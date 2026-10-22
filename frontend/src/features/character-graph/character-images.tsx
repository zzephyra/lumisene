import {
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  ImagePlus,
  Sparkles,
  Upload,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import type { Character } from "./api";
import type { CharacterImagesController } from "./use-character-images";
import "./character-images.css";

export function CharacterImages({
  controller: c,
  character,
}: {
  controller: CharacterImagesController;
  character: Character;
}) {
  const images = c.query.data?.images ?? [];
  const [preview, setPreview] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [mode, setMode] = useState<"candidate" | "reference">("candidate");
  const [instruction, setInstruction] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const gesture = useRef({ start: 0, scroll: 0, down: false, moved: false });
  const touchStart = useRef(0);
  const currentIndex = images.findIndex((image) => image.id === preview);
  const current = images[currentIndex];
  function step(delta: number) {
    if (images.length)
      setPreview(
        images[(currentIndex + delta + images.length) % images.length].id,
      );
  }
  function generate() {
    if (!images.length) {
      void c.generate("candidate", "", character);
      return;
    }
    setMode(images.length ? "reference" : "candidate");
    setGenerateOpen(true);
  }
  const latestJob = c.query.data?.jobs[0];
  return (
    <section className="character-images">
      <div className="character-images-heading">
        <h3>人物形象</h3>
        <span>{images.length ? `${images.length} 张` : ""}</span>
      </div>
      <input
        ref={file}
        className="sr-only"
        type="file"
        multiple
        accept="image/jpeg,image/png,image/webp"
        aria-label="上传人物形象"
        onChange={(event) => {
          c.upload(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      {c.query.isPending && <p role="status">正在加载形象…</p>}
      {c.query.isError && (
        <p role="alert">
          形象加载失败{" "}
          <button onClick={() => void c.query.refetch()}>重试</button>
        </p>
      )}
      {!c.query.isPending && !c.query.isError && !images.length && (
        <div className="character-images-empty">
          <ImagePlus size={28} aria-hidden />
          <strong>还没有人物形象</strong>
          <p>根据人物描述生成角色形象，或拖入参考照片</p>
          <Button disabled={c.running || c.pending} onClick={generate}>
            <Sparkles size={16} />
            AI 生成人物形象
          </Button>
          <Button variant="ghost" onClick={() => file.current?.click()}>
            上传照片
          </Button>
        </div>
      )}
      {!!images.length && (
        <>
          <div
            ref={list}
            className="character-images-carousel"
            aria-label="人物形象图片列表"
            onPointerDown={(event) => {
              if (
                event.pointerType !== "mouse" ||
                event.button !== 0 ||
                (event.target as HTMLElement).closest("[data-image-menu]")
              )
                return;
              gesture.current = {
                start: event.clientX,
                scroll: event.currentTarget.scrollLeft,
                down: true,
                moved: false,
              };
            }}
            onPointerMove={(event) => {
              const g = gesture.current;
              if (!g.down) return;
              const dx = event.clientX - g.start;
              if (Math.abs(dx) > 6) {
                g.moved = true;
                event.currentTarget.setPointerCapture(event.pointerId);
                event.currentTarget.scrollLeft = g.scroll - dx;
              }
            }}
            onPointerUp={() => {
              gesture.current.down = false;
            }}
            onPointerCancel={() => {
              gesture.current.down = false;
            }}
            onPointerLeave={(event) => {
              if (!event.currentTarget.hasPointerCapture(event.pointerId)) {
                gesture.current.down = false;
              }
            }}
            onLostPointerCapture={() => {
              gesture.current.down = false;
            }}
            onClickCapture={(event) => {
              if (gesture.current.moved) {
                event.stopPropagation();
                event.preventDefault();
                gesture.current.moved = false;
              }
            }}
          >
            {images.map((image) => (
              <article className="character-image-card" key={image.id}>
                <button
                  className="character-image-open"
                  aria-label={`查看${image.is_primary ? "主要形象" : "参考形象"}`}
                  onClick={() => setPreview(image.id)}
                >
                  <img
                    draggable={false}
                    src={image.image_url}
                    alt="人物形象"
                    loading="lazy"
                  />
                </button>
                {image.is_primary && (
                  <span className="character-primary-badge">主图</span>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      data-image-menu
                      className="character-image-menu"
                      aria-label="图片操作"
                    >
                      <Ellipsis size={18} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => setPreview(image.id)}>
                      放大查看
                    </DropdownMenuItem>
                    {!image.is_primary && (
                      <DropdownMenuItem
                        disabled={c.pending}
                        onSelect={() =>
                          void c.mutate(`${image.id}/primary`, "PUT")
                        }
                      >
                        设为主要形象
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={c.pending}
                      onSelect={() => setDeleting(image.id)}
                    >
                      删除图片
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </article>
            ))}
          </div>
          <div className="character-images-buttons">
            <Button variant="outline" onClick={() => file.current?.click()}>
              <Upload size={15} />
              添加图片
            </Button>
            <Button
              variant="ghost"
              disabled={c.running || c.pending}
              onClick={generate}
            >
              <Sparkles size={15} />
              AI 生成
            </Button>
          </div>
        </>
      )}
      {!!c.transfers.length && (
        <div className="character-upload-list" aria-live="polite">
          {c.transfers.map((item) => (
            <div key={item.id} className="character-upload-item">
              {item.preview && <img src={item.preview} alt="上传预览" />}
              <span>
                {item.file.name}
                <small>
                  {item.status === "uploading"
                    ? "上传中…"
                    : item.status === "succeeded"
                      ? "已上传并保存"
                      : item.error}
                </small>
              </span>
              {item.status === "failed" && item.preview && (
                <button onClick={() => void c.retry(item)}>重试</button>
              )}
            </div>
          ))}
        </div>
      )}
      {c.running && (
        <div className="character-generating" role="status">
          <Sparkles size={18} />
          正在生成人物形象…
        </div>
      )}
      {latestJob?.status === "failed" && !c.running && (
        <p role="alert">
          {latestJob.error || "生成失败"}
          <button onClick={generate}>重新生成</button>
        </p>
      )}
      {c.error && (
        <p role="alert" className="text-sm text-danger">
          {c.error}
        </p>
      )}
      <Dialog
        open={!!current}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
      >
        <DialogContent
          className="character-image-lightbox"
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              step(-1);
            }
            if (event.key === "ArrowRight") {
              event.preventDefault();
              step(1);
            }
          }}
        >
          <DialogTitle>人物形象预览</DialogTitle>
          <DialogDescription>
            {currentIndex + 1} / {images.length}
          </DialogDescription>
          {current && (
            <img
              src={current.image_url}
              alt="人物形象完整预览"
              onTouchStart={(event) => {
                touchStart.current = event.touches[0].clientX;
              }}
              onTouchEnd={(event) => {
                const dx = event.changedTouches[0].clientX - touchStart.current;
                if (Math.abs(dx) > 50) step(dx > 0 ? -1 : 1);
              }}
            />
          )}
          <div className="character-images-buttons">
            <Button
              variant="ghost"
              aria-label="上一张"
              disabled={images.length < 2}
              onClick={() => step(-1)}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="ghost"
              aria-label="下一张"
              disabled={images.length < 2}
              onClick={() => step(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <DialogContent>
          <DialogTitle>删除人物图片？</DialogTitle>
          <DialogDescription>
            从此人物的形象集合移除。删除主图后会自动选择另一张；不会删除其他地方使用的原文件。
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleting(null)}>
              取消
            </Button>
            <Button
              disabled={c.pending}
              onClick={async () => {
                if (deleting) await c.mutate(deleting, "DELETE");
                setDeleting(null);
              }}
            >
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={generateOpen} onOpenChange={setGenerateOpen}>
        <DialogContent>
          <DialogTitle>AI 生成人物形象</DialogTitle>
          <DialogDescription>
            使用当前人物设定（包含尚未保存的文字）。明确特征优先，新图片自动加入形象集合。
          </DialogDescription>
          {!!images.length && (
            <fieldset className="mt-4 space-y-3">
              <legend className="mb-2 text-sm">生成方式</legend>
              <label className="flex gap-2">
                <input
                  type="radio"
                  checked={mode === "reference"}
                  onChange={() => setMode("reference")}
                />
                基于主要形象补充参考图
              </label>
              <label className="flex gap-2">
                <input
                  type="radio"
                  checked={mode === "candidate"}
                  onChange={() => setMode("candidate")}
                />
                根据人物描述生成新候选
              </label>
              <p className="text-xs text-muted">
                参考模式需要模型支持图片输入，不支持时会明确提示。
              </p>
            </fieldset>
          )}
          <label className="mt-4 block text-sm">
            补充要求（可选）
            <textarea
              className="mt-2 w-full rounded-lg border border-line bg-canvas p-3"
              maxLength={2000}
              value={instruction}
              placeholder="例如：动漫风格、全身正面、换一套服装"
              onChange={(event) => setInstruction(event.target.value)}
            />
          </label>
          {c.error && (
            <p role="alert" className="text-danger">
              {c.error}
            </p>
          )}
          <Button
            className="mt-4"
            disabled={c.pending || c.running}
            onClick={async () => {
              if (await c.generate(mode, instruction, character))
                setGenerateOpen(false);
            }}
          >
            {c.pending ? "正在提交…" : "开始生成"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
