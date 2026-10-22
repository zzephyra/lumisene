import { useCallback, useEffect, useRef, useState } from "react";
import { message, write, type Scene, type SceneInput } from "./api";

/** One in-flight save; edits during it are saved next using its acknowledged version. */
export function useSceneDraft(
  root: string,
  initial: Scene,
  onSaved: () => void,
) {
  const key = `plot-draft:${root}:${initial.id}`;
  const restoredVersion = useRef(initial.version);
  const [draft, setDraft] = useState<SceneInput>(() => {
    try {
      const stored = JSON.parse(sessionStorage.getItem(key) || "null");
      if (
        typeof stored?.version === "number" &&
        stored?.draft &&
        Array.isArray(stored.draft.blocks)
      ) {
        restoredVersion.current = stored.version;
        return stored.draft;
      }
    } catch {
      /* A corrupt local draft never replaces the server document. */
    }
    return initial;
  });
  const latest = useRef(draft),
    version = useRef(restoredVersion.current);
  const revision = useRef(draft === initial ? 0 : 1),
    saved = useRef(0);
  const inFlight = useRef<Promise<boolean> | null>(null),
    mounted = useRef(true);
  const callback = useRef(onSaved);
  callback.current = onSaved;
  const [state, setState] = useState<"saved" | "dirty" | "saving" | "error">(
    revision.current ? "dirty" : "saved",
  );
  const [error, setError] = useState("");
  const change = (value: SceneInput) => {
    latest.current = value;
    revision.current++;
    setDraft(value);
    setState("dirty");
    setError("");
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ version: version.current, draft: value }),
      );
    } catch {
      /* Server save remains available. */
    }
  };
  const flush = useCallback(async (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const run = async () => {
      while (saved.current !== revision.current) {
        const target = revision.current;
        if (mounted.current) setState("saving");
        try {
          const result = await write<Scene>(
            `${root}/scenes/${initial.id}`,
            "PATCH",
            { ...latest.current, expected_version: version.current },
          );
          version.current = result.version;
          saved.current = target;
          try {
            if (saved.current === revision.current)
              sessionStorage.removeItem(key);
            else
              sessionStorage.setItem(
                key,
                JSON.stringify({
                  version: version.current,
                  draft: latest.current,
                }),
              );
          } catch {
            /* Storage quota does not undo an acknowledged save. */
          }
          callback.current();
        } catch (reason) {
          if (mounted.current) {
            setError(message(reason));
            setState("error");
          }
          return false;
        }
      }
      if (mounted.current) {
        setState("saved");
        setError("");
      }
      return true;
    };
    inFlight.current = run();
    try {
      return await inFlight.current;
    } finally {
      inFlight.current = null;
    }
  }, [initial.id, key, root]);
  useEffect(() => {
    if (state !== "dirty") return;
    const timer = setTimeout(() => void flush(), 800);
    return () => clearTimeout(timer);
  }, [draft, state, flush]);
  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => {
      if (saved.current !== revision.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const links = (event: MouseEvent) => {
      if (
        !(event.target as HTMLElement).closest("a[href]") ||
        saved.current === revision.current
      )
        return;
      if (
        !window.confirm(
          "还有未保存的修改，确定离开吗？草稿将保留在当前浏览器。",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", links, true);
    return () => {
      mounted.current = false;
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", links, true);
    };
  }, []);
  return { draft, change, flush, state, error, version };
}
