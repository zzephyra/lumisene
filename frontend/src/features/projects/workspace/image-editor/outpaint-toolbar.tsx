import { ASPECT_PRESETS } from "./types";
import type { useOutpaint } from "./hooks/use-outpaint";
export function OutpaintToolbar({
  state,
  onCancel,
}: {
  state: ReturnType<typeof useOutpaint>;
  onCancel: () => void;
}) {
  return (
    <section className="outpaint-toolbar" aria-label="扩图设置">
      <fieldset disabled={state.pending}>
        <div className="outpaint-controls">
          <div role="group" aria-label="扩图比例">
            {ASPECT_PRESETS.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-pressed={state.ratio === item.ratio}
                onClick={() => state.chooseRatio(item.ratio)}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label>
            扩展
            <select
              aria-label="扩展比例"
              value={state.percent}
              onChange={(event) => state.setPercent(Number(event.target.value))}
            >
              {[10, 20, 30, 50].map((n) => (
                <option value={n} key={n}>
                  {n}%
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="outpaint-controls">
          <div role="group" aria-label="扩图方向">
            {(
              [
                ["all", "四周"],
                ["left", "向左"],
                ["right", "向右"],
                ["top", "向上"],
                ["bottom", "向下"],
              ] as const
            ).map(([direction, text]) => (
              <button
                key={direction}
                type="button"
                onClick={() => state.quick(direction)}
              >
                {text}扩展
              </button>
            ))}
          </div>
          <span className="outpaint-dimensions">
            {state.frame.width} × {state.frame.height}
          </span>
        </div>
        <label className="outpaint-prompt">
          扩展内容
          <textarea
            aria-label="扩图描述"
            maxLength={800}
            onChange={(event) => state.setPrompt(event.target.value)}
            placeholder="例如：一位绿色仙子；留空时保持原图风格自然延展"
            rows={2}
            value={state.prompt}
          />
          <span>{state.prompt.length}/800</span>
        </label>
      </fieldset>
      {state.pending && <p role="status">{state.phase}</p>}
      {state.hint && <p role="status">{state.hint}</p>}
      {state.error && <p role="alert">{state.error}</p>}
      {!state.available && (
        <p>
          {state.loadingOptions
            ? "正在读取模型限制…"
            : state.reason || "请管理员启用 wanx2.1-imageedit 图像编辑模型"}
        </p>
      )}
      <div className="outpaint-actions">
        <button disabled={state.pending} onClick={onCancel} type="button">取消</button>
        <button disabled={state.pending} type="button" onClick={state.reset}>重置</button>
        <button className="image-editor-confirm" disabled={state.pending || !state.available} type="button" onClick={() => void state.generate()}>
          {state.pending ? "正在扩展图片…" : "确认扩图"}
        </button>
      </div>
    </section>
  );
}
