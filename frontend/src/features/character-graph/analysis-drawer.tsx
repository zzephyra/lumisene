import { FileText, Loader2, Sparkles, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { components } from "../../api/schema";
import { Button } from "../../components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../components/ui/dialog";
import { isRecord } from "../../lib/record";
import "./analysis-drawer.css";

export type AnalysisDocument = { id: string; filename: string };
type Job = components["schemas"]["AnalysisView"];

const stages: Record<string, string> = {
  parsing: "正在读取文档",
  extracting: "正在识别人物",
  resolving: "正在整理分析结果",
  review: "分析完成",
};

function stageLabel(job: Job) {
  if (job.status === "queued") return "排队中";
  if (job.status === "failed") return "分析失败";
  if (job.status === "canceled") return "分析已取消";
  if (job.status === "succeeded") return job.reviewed ? "已应用到人物关系图" : "分析完成";
  return stages[job.current_stage] ?? "正在分析";
}

function records(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function AnalysisDrawer({
  open,
  onOpenChange,
  document,
  uploading,
  error,
  pendingName,
  onUpload,
  onRemove,
  onRetryUpload,
  job,
  busy,
  existingNames,
  onStart,
  onRetry,
  onCancel,
  onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  document: AnalysisDocument | null;
  uploading: boolean;
  error: string;
  pendingName: string;
  onUpload: (file: File) => void;
  onRemove: () => void;
  onRetryUpload: () => void;
  job: Job | null;
  busy: boolean;
  existingNames: string[];
  onStart: () => void;
  onRetry: () => void;
  onCancel: () => void;
  onApply: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const running = !!job && ["queued", "running"].includes(job.status);
  const failed = !!job && ["failed", "canceled"].includes(job.status);
  const pendingReview = job?.status === "succeeded" && !job.reviewed;
  const characters = records(job?.result.characters);
  const relations = records(job?.result.relationships);
  const names = new Map(characters.map((item) => [String(item.key ?? ""), String(item.name ?? "")]));
  const known = new Set(existingNames);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="analysis-drawer"
        overlayClassName="analysis-drawer-overlay"
        aria-describedby="analysis-drawer-note"
      >
        <header className="analysis-drawer-header">
          <Sparkles aria-hidden size={18} />
          <div>
            <DialogTitle>AI 人物分析</DialogTitle>
            <DialogDescription id="analysis-drawer-note">从文档中提取人物与关系</DialogDescription>
          </div>
        </header>
        <div className="analysis-drawer-body">
          <section>
            <h3>导入故事文档</h3>
            <p>上传剧本或故事文本，AI 将识别人物及其关系。</p>
            {uploading ? (
              <div className="analysis-file" role="status">
                <Loader2 className="analysis-spin" size={16} />
                <span>
                  <strong>{pendingName || "文档"}</strong>
                  <small>正在上传…</small>
                </span>
              </div>
            ) : document ? (
              <div className="analysis-file">
                <FileText size={16} />
                <span>
                  <strong>{document.filename || "已关联文档"}</strong>
                  <small>{document.filename ? "可以开始分析" : "沿用当前分析任务的文档"}</small>
                </span>
                <button type="button" onClick={() => input.current?.click()}>替换</button>
                <button type="button" onClick={onRemove}>移除</button>
              </div>
            ) : (
              <button
                type="button"
                className={dragging ? "analysis-drop is-over" : "analysis-drop"}
                onClick={() => input.current?.click()}
                onDragEnter={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer.files[0];
                  if (file) onUpload(file);
                }}
              >
                <Upload size={18} />
                <span>点击或拖入 TXT、Markdown、DOCX、文字 PDF</span>
                <small>单个文件不超过 5 MB</small>
              </button>
            )}
            <input
              ref={input}
              className="sr-only"
              type="file"
              accept=".txt,.md,.markdown,.docx,.pdf"
              aria-label="选择故事文档"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onUpload(file);
                event.target.value = "";
              }}
            />
            {error && (
              <p className="analysis-error" role="alert">
                {error}
                {pendingName && !uploading && (
                  <button type="button" onClick={onRetryUpload}>重试</button>
                )}
              </p>
            )}
          </section>
          {job && (
            <section>
              <h3>分析状态</h3>
              <p>{stageLabel(job)}{job.status === "running" && job.progress > 0 ? ` · ${job.progress}%` : ""}</p>
              {running && (job.progress > 0 ? <progress max={100} value={job.progress} /> : <div className="analysis-indeterminate" />)}
              {job.error_message && <p className="analysis-error" role="alert">{job.error_message}</p>}
              {running && <Button variant="outline" className="h-8 px-3 text-xs" disabled={busy} onClick={onCancel}>取消分析</Button>}
              {job.status === "succeeded" && (
                <>
                  <p>{characters.length} 个人物 · {relations.length} 条关系。应用到图中时会新增人物，不修改已有档案。</p>
                  <ul className="analysis-people">
                    {characters.map((item, index) => {
                      const name = String(item.name ?? "未命名");
                      return (
                        <li key={String(item.key ?? index)}>
                          <strong>{name}</strong>
                          {known.has(name) && <em>图中已有同名人物</em>}
                          {typeof item.personality === "string" && item.personality && <small>{item.personality}</small>}
                        </li>
                      );
                    })}
                  </ul>
                  <ul className="analysis-relations">
                    {relations.map((item, index) => (
                      <li key={index}>
                        {names.get(String(item.source)) || String(item.source)}
                        <span>{String(item.relationship_type ?? "关系")}</span>
                        {names.get(String(item.target)) || String(item.target)}
                      </li>
                    ))}
                  </ul>
                  {pendingReview && document && (
                    <button type="button" className="analysis-again" disabled={busy || uploading} onClick={onStart}>
                      用当前文档重新分析
                    </button>
                  )}
                </>
              )}
            </section>
          )}
        </div>
        <footer className="analysis-drawer-footer">
          {running && <Button disabled><Loader2 className="analysis-spin" size={16} />正在分析…</Button>}
          {failed && <Button disabled={busy} onClick={onRetry}>重新分析</Button>}
          {pendingReview && <Button disabled={busy} onClick={onApply}>应用到人物关系图</Button>}
          {!running && !failed && !pendingReview && (
            <Button disabled={!document || busy || uploading} onClick={onStart}>开始 AI 分析</Button>
          )}
          {!document && !running && !failed && !pendingReview && <p>导入文档后才能开始分析。</p>}
        </footer>
      </DialogContent>
    </Dialog>
  );
}
