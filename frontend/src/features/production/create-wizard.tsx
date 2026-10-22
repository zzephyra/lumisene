import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, Link } from "react-router";
import { Check, Clapperboard } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import { Select } from "../../components/ui/select";
import { SettingsField, SettingsForm } from "./settings-form";
import { WizardReferences } from "./wizard-references";
import { Storyboard } from "./board-editor";
import { ShotInspector } from "./shot-inspector";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
import {
  active,
  change,
  defaultSettings,
  message,
  read,
  root,
  updateShot,
  newScene,
  type Source,
  type Settings,
  type Selection,
  type Production,
  type Board,
  type Impact,
  type Capability,
} from "./api";
import "./production.css";
const STEPS = ["基础配置", "素材准备", "分镜规划", "确认生成"];
const STEP_STARTS = [0, 2, 4, 5];
export function CreateProductionWizard({
  projectId,
  storyId,
  storyTitle,
  open,
  onClose,
  initialProductionId,
}: {
  projectId: string;
  storyId: string;
  storyTitle: string;
  open: boolean;
  onClose: () => void;
  initialProductionId?: string;
}) {
  const navigate = useNavigate(),
    client = useQueryClient();
  const [step, setStep] = useState(0),
    [selections, setSelections] = useState<Selection[]>([]),
    [settings, setSettings] = useState<Settings>(defaultSettings),
    [title, setTitle] = useState(storyTitle + " · 视频");
  const [id, setId] = useState(initialProductionId),
    [production, setProduction] = useState<Production | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [boardDraft, setBoardDraft] = useState<Board | null>(null),
    [planId, setPlanId] = useState<string | null>(null),
    [previousPlanBoard, setPreviousPlanBoard] = useState<Board | null>(null),
    [selectedShot, setSelectedShot] = useState(""),
    [saveStatus, setSaveStatus] = useState("");
  const initialized = useRef(""),
    submitting = useRef(false),
    intent = useRef<{ version: number; key: string } | null>(null);
  const base = root(projectId, storyId),
    endpoint = (p: Production) => base + "/" + p.id;
  const source = useQuery({
    queryKey: ["projects", projectId, "production-source", storyId],
    queryFn: ({ signal }) =>
      read<Source>(root(projectId) + "/source/" + storyId, signal),
    enabled: open,
  });
  const saved = useQuery({
    queryKey: ["projects", projectId, "productions", id],
    queryFn: ({ signal }) => read<Production>(base + "/" + id, signal),
    enabled: open && !!id,
    refetchInterval: (q) =>
      q.state.data?.runs.some((r) => active(r.status)) ? 2500 : false,
  });
  const capabilities = useQuery({
    queryKey: ["projects", projectId, "production-capabilities"],
    queryFn: ({ signal }) => read<Capability[]>(base + "/capabilities", signal),
    enabled: open,
  });
  useEffect(() => {
    if (!saved.data) return;
    const p = saved.data;
    setProduction(p);
    if (initialized.current === p.id) return;
    initialized.current = p.id;
    setSettings(p.settings);
    setTitle(p.title);
    setStep(p.settings.wizard_step ?? 0);
    const raw = p.snapshot.selection;
    setSelections(
      Array.isArray(raw)
        ? raw.filter(isRecord).map((s) => ({
            chapter_id: String(s.chapter_id),
            scene_ids: Array.isArray(s.scene_ids)
              ? s.scene_ids.map(String)
              : null,
          }))
        : (Array.isArray(p.snapshot.chapters) ? p.snapshot.chapters : [])
            .filter(isRecord)
            .map((c) => ({ chapter_id: String(c.id), scene_ids: null })),
    );
  }, [saved.data]);
  const uiStep = step < 2 ? 0 : step < 4 ? 1 : step - 2;
  const board = boardDraft ?? production?.board;
  const shots = board?.scenes?.flatMap((s) => s.shots ?? []) ?? [],
    shot = shots.find((s) => s.id === selectedShot),
    scene = board?.scenes?.find((s) =>
      s.shots?.some((s) => s.id === selectedShot),
    );
  const chapters = source.data?.chapters ?? [],
    chosen = selections.flatMap((sel) =>
      chapters.filter((c) => c.id === sel.chapter_id),
    );

  const clipLengths = (capabilities.data ?? []).flatMap((item) => {
      const raw = item.parameters?.duration;
      return item.available &&
        item.operation.endsWith("video") &&
        Array.isArray(raw)
        ? raw.filter((value): value is number => typeof value === "number")
        : [];
    }),
    maxClip = clipLengths.length ? Math.max(...clipLengths) : null;
  const latestPlan = production?.runs.find((r) => r.kind === "plan");
  const planning = !!latestPlan && active(latestPlan.status);
  const reportedFailure = useRef<string | null>(null);
  useEffect(() => {
    if (
      !open ||
      latestPlan?.status !== "failed" ||
      reportedFailure.current === latestPlan.id
    )
      return;
    reportedFailure.current = latestPlan.id;
    setNotice("");
    setError(
      /timed? out|timeout|超时/i.test(latestPlan.error ?? "")
        ? "AI 分镜规划超时，请稍后重新规划。已有分镜和编辑内容已保留。"
        : message(new Error(latestPlan.error || "AI 分镜规划失败，请重试。")),
    );
  }, [open, latestPlan]);

  const autoLoadedPlan = useRef<string | null>(null);
  useEffect(() => {
    // A first result may fill an empty workspace, but never replace a local or saved edit.
    if (
      !open ||
      step !== 4 ||
      boardDraft !== null ||
      production?.board.scenes?.some((scene) => scene.shots?.length) ||
      latestPlan?.status !== "succeeded" ||
      !latestPlan.result ||
      latestPlan.applied ||
      autoLoadedPlan.current === latestPlan.id
    )
      return;
    autoLoadedPlan.current = latestPlan.id;
    setBoardDraft(latestPlan.result);
    setPlanId(latestPlan.id);
    setNotice("AI 分镜已生成并展示，可直接编辑；点击下一步保存采用。");
  }, [open, step, boardDraft, production?.board, latestPlan]);
  const running = production?.runs.some((r) => active(r.status));
  const executing = production?.runs.some(
    (r) => r.kind === "execution" && active(r.status),
  );
  const validScope =
    selections.length > 0 &&
    !selections.some(
      (s) =>
        s.scene_ids?.length === 0 ||
        !chapters.some((c) => c.id === s.chapter_id),
    );
  function accept(p: Production) {
    setProduction(p);
    setId(p.id);
    client.setQueryData(["projects", projectId, "productions", p.id], p);
    return p;
  }
  function upstream(next: Settings) {
    intent.current = null;
    setPlanId(null);

    setSettings(next);
    if (shots.length)
      setNotice(
        "制作设置已调整，已有分镜保留。请重新规划或逐镜复核后确认生成。",
      );
  }
  async function persist(): Promise<Production> {
    if (!validScope) throw new Error("请选择有效的故事章节");
    const sceneIds = new Set(
      chosen.flatMap((c) =>
        c.scenes
          .filter((s) => {
            const selection = selections.find((x) => x.chapter_id === c.id);
            return (
              selection?.scene_ids == null || selection.scene_ids.includes(s.id)
            );
          })
          .map((s) => s.id),
      ),
    );
    const savedSettings = {
      ...settings,
      wizard_step: step,
      scene_references: Object.fromEntries(
        Object.entries(settings.scene_references ?? {}).filter(([id]) =>
          sceneIds.has(id),
        ),
      ),
    };
    let p = production;
    if (!p) {
      p = accept(
        await change(base, "POST", {
          story_id: storyId,
          title,
          selections,
          settings: savedSettings,
        }),
      );
      initialized.current = p.id;
    } else {
      if (
        JSON.stringify(p.snapshot.selection ?? []) !==
        JSON.stringify(selections)
      ) {
        const impact = await read<Impact>(endpoint(p) + "/source-impact");
        p = accept(
          await change(endpoint(p) + "/sync-source", "POST", {
            expected_version: p.version,
            fingerprint: impact.fingerprint,
            selections,
          }),
        );
      }
      p = accept(
        await change(endpoint(p) + "/settings", "PUT", {
          expected_version: p.version,
          settings: savedSettings,
        }),
      );
    }
    return p;
  }
  async function task(fn: () => Promise<void>) {
    if (submitting.current) return false;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      await fn();
      return true;
    } catch (e) {
      setSaveStatus("保存或操作失败，请重试");
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
      submitting.current = false;
    }
  }
  async function saveDraft() {
    return task(async () => {
      setSaveStatus("正在保存…");
      let p = await persist();
      if (boardDraft) {
        p = accept(
          await change(endpoint(p) + "/board", "PUT", {
            expected_version: p.version,
            board: boardDraft,
          }),
        );
        setBoardDraft(null);
        setPlanId(null);
      }
      setSaveStatus("已保存");
    });
  }
  const autosaved = useRef<Board | null>(null);
  const savedConfig = useRef<string | null>(null);
  const configSnapshot = JSON.stringify([title, settings, selections, step]);
  useEffect(() => {
    if (id && !production) return;
    if (savedConfig.current === null) savedConfig.current = configSnapshot;
    if (
      !open ||
      busy ||
      running ||
      !validScope ||
      ((!boardDraft || autosaved.current === boardDraft) &&
        savedConfig.current === configSnapshot)
    )
      return;
    const timer = window.setTimeout(() => {
      autosaved.current = boardDraft;
      savedConfig.current = configSnapshot;
      void saveDraft();
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [
    open,
    busy,
    running,
    boardDraft,
    configSnapshot,
    validScope,
    id,
    production,
  ]);
  async function plan(shotId?: string) {
    await task(async () => {
      let p = await persist();
      if (shotId && board) {
        p = accept(
          await change(endpoint(p) + "/board", "PUT", {
            expected_version: p.version,
            board,
          }),
        );
      }
      accept(
        await change(
          endpoint(p) + "/plans",
          "POST",
          {
            expected_version: p.version,
            shot_id: shotId,
            instruction:
              "按当前故事范围、人物与参考配置规划。只使用选中的故事原文，保持核心事件与关系。",
          },
          crypto.randomUUID(),
        ),
      );
      setPlanId(null);
      setNotice(
        shots.length || boardDraft !== null
          ? "正在规划。已有人工编辑内容会保留，新方案完成后由你选择载入。"
          : "正在规划，完成后将自动展示分镜。",
      );
    });
  }
  async function next() {
    if (step === 4) {
      await task(async () => {
        if (!production || !board || !shots.length)
          throw new Error("请先规划或添加分镜");
        const p = accept(
          await change(
            endpoint(production) +
              (planId ? "/plans/" + planId + "/apply" : "/board"),
            planId ? "POST" : "PUT",
            { expected_version: production.version, board },
          ),
        );
        setBoardDraft(null);
        setPlanId(null);
        setStep(5);
        setNotice("分镜已保存，请核对摘要后确认。");
        accept(p);
      });
    } else if (step === 2 || step === 3) {
      await task(async () => {
        await persist();
        setStep(4);
      });
    } else setStep(2);
  }
  async function execute() {
    await task(async () => {
      if (!production || !board || !production.readiness?.allowed)
        throw new Error("请先完成分镜规划");
      if (!intent.current) {
        const confirmed = {
          ...board,
          scenes: board.scenes?.map((c) => ({
            ...c,
            shots: c.shots?.map((s) => ({ ...s, confirmed: true })),
          })),
        };
        const p = accept(
          await change(endpoint(production) + "/board", "PUT", {
            expected_version: production.version,
            board: confirmed,
          }),
        );
        intent.current = { version: p.version, key: crypto.randomUUID() };
      }
      await change(
        endpoint(production) + "/execute",
        "POST",
        {
          expected_version: intent.current.version,

          auto_export: true,
        },
        intent.current.key,
      );
      await client.invalidateQueries({
        queryKey: ["projects", projectId, "stories", storyId, "productions"],
      });
      onClose();
      navigate(`/projects/${projectId}/stories/${storyId}/films`);
    });
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (v || busy) return;
        if (
          (boardDraft ||
            (savedConfig.current !== null &&
              savedConfig.current !== configSnapshot)) &&
          validScope &&
          !running
        )
          void saveDraft().then((ok) => {
            if (ok) onClose();
          });
        else onClose();
      }}
    >
      <DialogContent className="production-wizard production-wizard-v3">
        <header>
          <DialogTitle>
            <Clapperboard size={20} />
            生成视频 · {storyTitle}
          </DialogTitle>
          <DialogDescription>
            从故事到成片，先规划，再确认生成。编辑内容自动保存。
          </DialogDescription>
        </header>
        <div className="production-compact-info">
          {storyTitle} · 目标 {settings.target_duration} 秒 · {shots.length}{" "}
          个镜头 · {settings.aspect_ratio} · {settings.resolution}P{" "}
          <span>{saveStatus}</span>
        </div>
        <ol className="production-wizard-steps">
          {STEPS.map((label, i) => (
            <li key={label} aria-current={uiStep === i ? "step" : undefined}>
              <button
                disabled={busy || executing || i > uiStep}
                onClick={() => {
                  intent.current = null;
                  setStep(STEP_STARTS[i]);
                }}
              >
                {i < uiStep ? <Check size={14} /> : i + 1} · {label}
              </button>
            </li>
          ))}
        </ol>
        <div className="production-wizard-body">
          <main>
            {saved.isError ? (
              <Button onClick={() => void saved.refetch()}>
                草稿加载失败，重试
              </Button>
            ) : executing ? (
              <div className="production-empty">
                <p>此制作正在后台执行，输入暂时锁定。</p>
                <Link to={`/projects/${projectId}/stories/${storyId}/films`}>
                  查看生成进度
                </Link>
              </div>
            ) : (
              <fieldset
                disabled={busy || !!running}
                data-planning={planning && step === 4 ? "true" : undefined}
              >
                {step <= 1 && (
                  <>
                    <h2>选择要制作的剧情</h2>
                    <p className="text-muted">
                      从当前故事中选择章节，AI 将根据选中的内容规划视频。
                    </p>
                    {source.isPending ? (
                      <div className="production-skeleton" />
                    ) : source.isError ? (
                      <Button onClick={() => void source.refetch()}>
                        载入失败，重试
                      </Button>
                    ) : !chapters.length ? (
                      <div className="production-empty">
                        <p>当前故事还没有可用章节，请先创建或导入剧情。</p>
                        <Link
                          to={`/projects/${projectId}/stories/${storyId}/plot`}
                          onClick={onClose}
                        >
                          前往剧情
                        </Link>
                      </div>
                    ) : (
                      <>
                        <div className="production-list-actions">
                          <Button
                            variant="outline"
                            onClick={() =>
                              setSelections(
                                chapters.map((c) => ({
                                  chapter_id: c.id,
                                  scene_ids: null,
                                })),
                              )
                            }
                          >
                            全选
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => setSelections([])}
                          >
                            取消全选
                          </Button>
                        </div>
                        {chapters.map((c, i) => {
                          const selected = selections.find(
                            (s) => s.chapter_id === c.id,
                          );
                          return (
                            <article
                              className="production-chapter-choice"
                              key={c.id}
                            >
                              <label className="production-check">
                                <input
                                  type="checkbox"
                                  checked={!!selected}
                                  onChange={(e) => {
                                    const next = e.target.checked
                                      ? [
                                          ...selections,
                                          { chapter_id: c.id, scene_ids: null },
                                        ]
                                      : selections.filter(
                                          (s) => s.chapter_id !== c.id,
                                        );
                                    setSelections(next);
                                    if (shots.length)
                                      setNotice(
                                        "制作范围已修改，请重新规划或复核现有镜头。",
                                      );
                                  }}
                                />
                                <strong>
                                  {i + 1}. {c.title}
                                </strong>
                              </label>
                              <p>{c.summary || "暂无摘要"}</p>
                              <small>
                                {c.text_length} 字 ·{" "}
                                {c.character_names?.length ?? 0} 位人物
                              </small>
                              <details>
                                <summary>预览剧情与场景</summary>
                                {c.scenes.map((sc) => (
                                  <section key={sc.id}>
                                    {selected && (
                                      <label className="production-check">
                                        <input
                                          type="checkbox"
                                          checked={
                                            selected.scene_ids == null ||
                                            selected.scene_ids.includes(sc.id)
                                          }
                                          onChange={(e) => {
                                            const ids =
                                              selected.scene_ids ??
                                              c.scenes.map((s) => s.id);
                                            setSelections(
                                              selections.map((s) =>
                                                s.chapter_id === c.id
                                                  ? {
                                                      ...s,
                                                      scene_ids: e.target
                                                        .checked
                                                        ? [...ids, sc.id]
                                                        : ids.filter(
                                                            (v) => v !== sc.id,
                                                          ),
                                                    }
                                                  : s,
                                              ),
                                            );
                                          }}
                                        />
                                        {sc.title}
                                      </label>
                                    )}
                                    <p className="production-source-text">
                                      {sc.blocks
                                        ?.map((b) => String(b.content ?? ""))
                                        .join("\n\n")}
                                    </p>
                                  </section>
                                ))}
                              </details>
                            </article>
                          );
                        })}
                      </>
                    )}
                  </>
                )}
                {step <= 1 && (
                  <>
                    {selections.length > 1 && (
                      <details>
                        <summary>章节顺序</summary>
                        {selections.map((selection, index) => (
                          <div
                            className="production-scope-order"
                            key={selection.chapter_id}
                          >
                            <span>
                              {chapters.find(
                                (c) => c.id === selection.chapter_id,
                              )?.title ?? "章节不可用"}
                            </span>
                            <Button
                              variant="ghost"
                              disabled={index === 0}
                              onClick={() => {
                                const next = [...selections];
                                [next[index - 1], next[index]] = [
                                  next[index],
                                  next[index - 1],
                                ];
                                setSelections(next);
                              }}
                            >
                              上移
                            </Button>
                            <Button
                              variant="ghost"
                              disabled={index === selections.length - 1}
                              onClick={() => {
                                const next = [...selections];
                                [next[index + 1], next[index]] = [
                                  next[index],
                                  next[index + 1],
                                ];
                                setSelections(next);
                              }}
                            >
                              下移
                            </Button>
                          </div>
                        ))}
                      </details>
                    )}
                    <h2>设置视频规格</h2>
                    <SettingsForm value={settings} onChange={upstream} />
                  </>
                )}
                {(step === 2 || step === 3) && source.data && (
                  <WizardReferences
                    projectId={projectId}
                    storyId={storyId}
                    source={source.data}
                    selections={selections}
                    value={settings}
                    onChange={upstream}
                  />
                )}
                {(step === 2 || step === 3) && (
                  <div className="production-settings-form">
                    <h2>配置声音与风格</h2>
                    <SettingsField label="声音处理">
                      <Select
                        id="audio-mode"
                        label="声音处理"
                        value={settings.audio_mode ?? "source"}
                        options={[
                          {
                            value: "source",
                            label: "保留生成视频自带声音（如有）",
                          },
                          { value: "silent", label: "无声音 · 导出时静音" },
                        ]}
                        onChange={(v) =>
                          upstream({
                            ...settings,
                            audio_mode: v as Settings["audio_mode"],
                          })
                        }
                      />
                    </SettingsField>
                    <p className="production-settings-note">
                      当前没有接入独立配音、音色、音乐、音效和字幕生成服务，不能启用这些能力。不会擅自上传或克隆声音。
                    </p>
                    <SettingsField label="视觉风格">
                      <Select
                        id="style-preset"
                        label="视觉风格"
                        value={
                          ["写实影视", "动漫", "2D 插画", "3D 动画"].includes(
                            settings.visual_style ?? "",
                          )
                            ? settings.visual_style!
                            : "custom"
                        }
                        options={["写实影视", "动漫", "2D 插画", "3D 动画"]
                          .map((v) => ({ value: v, label: v }))
                          .concat({ value: "custom", label: "自定义" })}
                        onChange={(v) =>
                          upstream({
                            ...settings,
                            visual_style: v === "custom" ? "" : v,
                          })
                        }
                      />
                    </SettingsField>
                    <SettingsField label="风格描述">
                      <textarea
                        maxLength={500}
                        value={settings.visual_style}
                        onChange={(e) =>
                          upstream({
                            ...settings,
                            visual_style: e.target.value,
                          })
                        }
                      />
                    </SettingsField>
                    <p className="production-settings-note">
                      故事封面不会自动作为全片参考。
                    </p>
                  </div>
                )}
                {step === 4 && (
                  <>
                    <h2>规划视频分镜</h2>
                    <p>
                      目标 {settings.target_duration}s · 当前{" "}
                      {shots.reduce((n, s) => n + s.duration, 0).toFixed(1)}s ·{" "}
                      {shots.length} 个镜头
                      {maxClip != null ? ` · 模型单次最长 ${maxClip}s` : ""}
                    </p>
                    <div className="production-list-actions">
                      <Button aria-busy={planning} onClick={() => void plan()}>
                        <Clapperboard size={16} />
                        {planning
                          ? "正在规划分镜…"
                          : shots.length
                            ? "重新规划（保留现稿）"
                            : "AI 规划分镜"}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() =>
                          setBoardDraft({
                            ...board!,
                            adaptation_summary: board?.adaptation_summary ?? "",
                            visual_style: settings.visual_style ?? "",
                            scenes: [...(board?.scenes ?? []), newScene()],
                          })
                        }
                      >
                        手动添加场景
                      </Button>
                    </div>
                    {planning && (
                      <div
                        className="production-plan-loading"
                        role="status"
                        aria-live="polite"
                      >
                        <strong>
                          {latestPlan.status === "queued"
                            ? "分镜规划已排队"
                            : "AI 正在分析剧情并规划分镜"}
                        </strong>
                        <p>
                          正在整理场景、镜头与时长。完成后会自动展示首次方案，可以离开页面后继续。
                        </p>
                        {!shots.length && (
                          <div
                            className="production-plan-skeletons"
                            aria-hidden="true"
                          >
                            {[0, 1, 2].map((i) => (
                              <div className="production-skeleton" key={i} />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {latestPlan?.status === "succeeded" &&
                      latestPlan.result &&
                      !latestPlan.applied &&
                      planId !== latestPlan.id &&
                      autoLoadedPlan.current !== latestPlan.id && (
                        <Button
                          variant="outline"
                          onClick={() => {
                            setPreviousPlanBoard(board ?? null);
                            autoLoadedPlan.current = latestPlan.id;
                            setBoardDraft(latestPlan.result!);
                            setPlanId(latestPlan.id);
                            setNotice(
                              "已载入新方案预览，下一步将采用当前编辑版本。",
                            );
                          }}
                        >
                          载入最新规划预览（替换本地编辑）
                        </Button>
                      )}
                    {previousPlanBoard && (
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setBoardDraft(previousPlanBoard);
                          setPreviousPlanBoard(null);
                          setPlanId(null);
                        }}
                      >
                        撤销载入方案
                      </Button>
                    )}
                    {shots.length > 0 &&
                      Math.abs(
                        shots.reduce((n, s) => n + s.duration, 0) -
                          settings.target_duration,
                      ) > 0.5 && (
                        <p className="text-muted">
                          {shots.reduce((n, s) => n + s.duration, 0) <
                          settings.target_duration
                            ? `当前镜头总时长不足，还需补充约 ${(settings.target_duration - shots.reduce((n, s) => n + s.duration, 0)).toFixed(1)} 秒。`
                            : "当前镜头总时长超过目标，可调整镜头或目标时长。"}
                        </p>
                      )}
                    {board && !(planning && !shots.length) && (
                      <Storyboard
                        projectId={projectId}
                        board={board}
                        selected={selectedShot}
                        onSelect={setSelectedShot}
                        onEdit={setBoardDraft}
                        disabled={busy || !!running}
                        maxDuration={maxClip}
                        onOptimize={(id) => void plan(id)}
                      />
                    )}{" "}
                    {board && shot && scene && (
                      <Dialog
                        open
                        onOpenChange={(v) => {
                          if (!v) setSelectedShot("");
                        }}
                      >
                        <DialogContent className="production-shot-drawer">
                          <DialogTitle>编辑镜头</DialogTitle>
                          <DialogDescription>
                            修改仅作用于当前镜头；场景设置由该场景共用。
                          </DialogDescription>
                          <Button
                            variant="outline"
                            disabled={busy || !!running}
                            onClick={() => void plan(shot.id)}
                          >
                            重新规划此镜头
                          </Button>
                          <ShotInspector
                            projectId={projectId}
                            storyId={storyId}
                            shot={shot}
                            scene={scene}
                            onChange={(patch) =>
                              setBoardDraft(updateShot(board, shot.id!, patch))
                            }
                            onScene={(patch) =>
                              setBoardDraft({
                                ...board,
                                scenes: board.scenes?.map((s) =>
                                  s.id === scene.id ? { ...s, ...patch } : s,
                                ),
                              })
                            }
                            onPrompt={() =>
                              void task(async () => {
                                let p = await persist();
                                p = accept(
                                  await change(endpoint(p) + "/board", "PUT", {
                                    expected_version: p.version,
                                    board,
                                  }),
                                );
                                setPlanId(null);
                                const result = (await apiRequest({
                                  path: `${endpoint(p)}/shots/${shot.id}/prompt`,
                                  method: "POST",
                                  csrf: true,
                                })) as { prompt: string };
                                setBoardDraft(
                                  updateShot(p.board, shot.id!, {
                                    prompt: result.prompt,
                                    confirmed: false,
                                  }),
                                );
                              })
                            }
                            disabled={busy}
                          />
                        </DialogContent>
                      </Dialog>
                    )}
                  </>
                )}
                {step === 5 && (
                  <div className="production-confirm">
                    <h2>确认生成</h2>
                    <p>检查制作计划，准备好后即可开始。</p>
                    <dl className="production-confirm-facts">
                      <dt>视频</dt>
                      <dd>{title}</dd>
                      <dt>章节</dt>
                      <dd>{chosen.map((c) => c.title).join("、")}</dd>
                      <dt>时长</dt>
                      <dd>
                        约{" "}
                        {shots.reduce((n, s) => n + s.duration, 0).toFixed(1)}{" "}
                        秒
                      </dd>
                      <dt>镜头</dt>
                      <dd>{shots.length} 个</dd>
                      <dt>画幅与清晰度</dt>
                      <dd>
                        {settings.aspect_ratio} · {settings.resolution}P
                      </dd>
                    </dl>
                    {!production?.readiness?.allowed && (
                      <div role="status">
                        <p>
                          {production?.readiness?.message ?? "正在检查生成条件"}
                        </p>
                        <Button
                          variant="outline"
                          onClick={() => void saved.refetch()}
                        >
                          重新检查
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </fieldset>
            )}
            {running && !executing && step !== 4 && (
              <div role="status" className="production-planning-status">
                <div className="production-skeleton" />
                AI 正在规划，可以关闭向导稍后恢复。
              </div>
            )}
            {notice && <p role="status">{notice}</p>}
            {error && (
              <div className="production-error-toast" role="alert">
                <span>{error}</span>
                <button
                  type="button"
                  aria-label="关闭错误提示"
                  onClick={() => setError("")}
                >
                  ×
                </button>
              </div>
            )}
          </main>
        </div>
        <footer>
          <Button
            variant="ghost"
            disabled={step === 0 || busy || !!running}
            onClick={() => {
              intent.current = null;
              setStep(STEP_STARTS[Math.max(0, uiStep - 1)]);
            }}
          >
            上一步
          </Button>
          <div>
            <Button
              variant="outline"
              disabled={busy || !!running || !validScope}
              onClick={() => void saveDraft()}
            >
              保存草稿
            </Button>
            {step < 5 ? (
              <Button
                disabled={
                  busy ||
                  !!running ||
                  !validScope ||
                  (step === 4 && !shots.length)
                }
                onClick={() => void next()}
              >
                下一步
              </Button>
            ) : (
              <Button
                disabled={
                  busy ||
                  !!running ||
                  !production?.readiness?.allowed ||
                  !shots.length
                }
                onClick={() => void execute()}
              >
                {busy ? "正在提交…" : "开始生成"}
              </Button>
            )}
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
