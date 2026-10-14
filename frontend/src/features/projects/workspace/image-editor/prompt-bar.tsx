import { useId } from "react";

export function inpaintReason(input: {
  busy: boolean;
  hasSelection: boolean;
  prompt: string;
  modelBlocked: boolean;
}): string | null {
  if (input.busy) {
    return "正在准备图片。";
  }
  if (input.modelBlocked) {
    return "当前模型不支持图片编辑。";
  }
  if (!input.hasSelection) {
    return "请先框选需要修改的区域。";
  }
  if (!input.prompt.trim()) {
    return "请输入修改要求。";
  }
  return null;
}

export function PromptBar({
  value,
  busy,
  hasSelection,
  modelBlocked = false,
  onChange,
  onSubmit,
}: {
  value: string;
  busy: boolean;
  hasSelection: boolean;
  modelBlocked?: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
}) {
  const hintId = useId();
  const reason = inpaintReason({ busy, hasSelection, prompt: value, modelBlocked });
  return (
    <div>
      <form
        className="image-editor-prompt"
        onSubmit={(event) => {
          event.preventDefault();
          if (!reason) {
            onSubmit();
          }
        }}
      >
        <input
          aria-describedby={hintId}
          aria-label="重绘描述"
          onChange={(event) => onChange(event.target.value)}
          placeholder="描述你想修改的内容"
          value={value}
        />
        <button aria-describedby={hintId} disabled={!!reason} title={reason ?? "生成选区内的修改"} type="submit">
          {busy ? "准备中…" : "生成"}
        </button>
      </form>
      <p className="image-editor-selection-hint" id={hintId} role="status">
        {reason ?? "已确定修改区域。生成后只替换选区内的内容，选区外保持不变。"}
      </p>
    </div>
  );
}
