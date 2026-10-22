import { CharacterImages } from "./character-images";
import { useCharacterImages } from "./use-character-images";
import { EvidenceList } from "./evidence-list";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../../components/ui/button";
import { CharacterProfileForm } from "./character-profile-form";
import {
  detail,
  save,
  remove,
  type Character,
  type Relationship,
  type Selection,
  type Graph,
} from "./api";
export function Inspector({
  projectId,
  storyId,
  selection,
  graph,
  onDirty,
  onClose,
  onSaved,
  onSelect,
}: {
  projectId: string;
  storyId: string;
  selection: Exclude<Selection, { kind: "none" }>;
  graph: Graph;
  onDirty: (dirty: boolean) => void;
  onClose: () => void;
  onSaved: () => void;
  onSelect: (s: Selection) => void;
}) {
  const dirty = useRef(false);
  const images = useCharacterImages(
    projectId,
    storyId,
    selection.kind === "character" ? selection.id : null,
  );
  const query = useQuery({
    queryKey: [
      "projects",
      projectId,
      "stories",
      storyId,
      "character-detail",
      selection.kind,
      selection.id,
    ],
    queryFn: ({ signal }) => detail(projectId, storyId, selection, signal),
  });
  const [draft, setDraft] = useState<Character | Relationship | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState("");
  useEffect(() => {
    dirty.current = false;
    setDraft(null);
    setMessage("");
    onDirty(false);
  }, [selection.kind, selection.id]);
  useEffect(() => {
    if (query.data && !dirty.current) {
      setDraft(query.data);
      onDirty(false);
    }
  }, [query.data]);
  function change(v: Character | Relationship) {
    dirty.current = true;
    setDraft(v);
    onDirty(true);
    setMessage("未保存");
  }
  async function submit() {
    if (!draft) return;
    setPending(true);
    setMessage("");
    try {
      const { id, project_id, version, ...body } = draft;
      if ("avatar_url" in body) delete body.avatar_url;
      if ("avatar_upload_id" in body) delete body.avatar_upload_id;
      await save(
        projectId,
        storyId,
        selection.kind,
        { ...body, expected_version: version },
        id,
      );
      dirty.current = false;
      onDirty(false);
      await query.refetch();
      onSaved();
      setMessage("已保存");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setPending(false);
    }
  }
  async function destroy() {
    if (!draft) return;
    const count = graph.relationships.filter(
      (r) =>
        r.source_character_id === draft.id ||
        r.target_character_id === draft.id,
    ).length;
    if (
      !window.confirm(
        selection.kind === "character"
          ? `删除此人物及 ${count} 条关联关系？`
          : "删除此关系？",
      )
    )
      return;
    setPending(true);
    try {
      await remove(projectId, storyId, selection.kind, draft.id, draft.version);
      onDirty(false);
      onSaved();
      onClose();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "删除失败");
    } finally {
      setPending(false);
    }
  }
  const character =
      draft?.id === selection.id && "name" in draft ? draft : null,
    relationship =
      draft?.id === selection.id && "source_character_id" in draft
        ? draft
        : null;
  const refs =
    relationship?.evidence_refs ??
    (character?.profile_data
      ? Object.values(character.profile_data).flatMap((group) =>
          typeof group === "object" && group
            ? Object.values(group).flatMap((fact) => fact.evidence_refs ?? [])
            : [],
        )
      : []);
  return (
    <aside
      {...images.dropzone}
      className="character-inspector"
      aria-label={selection.kind === "character" ? "人物详情" : "关系详情"}
    >
      {images.dragging && (
        <div className="character-drop-overlay">
          <strong>松开以上传人物形象</strong>
          <span>支持 JPG / PNG / WebP · 最大 20 MB</span>
        </div>
      )}
      <header>
        <h2>{selection.kind === "character" ? "人物档案" : "关系详情"}</h2>
        <button aria-label="关闭详情" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="inspector-scroll">
        {query.isPending && <p role="status">正在加载详情…</p>}
        {query.isError && (
          <p role="alert">
            加载失败 <button onClick={() => query.refetch()}>重试</button>
          </p>
        )}
        {character && (
          <>
            <CharacterImages
              key={character.id}
              controller={images}
              character={character}
            />
            <CharacterProfileForm value={character} onChange={change} />
            <section>
              <h3>人物关系</h3>
              {graph.relationships
                .filter(
                  (r) =>
                    r.source_character_id === character.id ||
                    r.target_character_id === character.id,
                )
                .map((r) => {
                  const other =
                    r.source_character_id === character.id
                      ? r.target_character_id
                      : r.source_character_id;
                  return (
                    <p key={r.id}>
                      <button
                        onClick={() =>
                          onSelect({ kind: "character", id: other })
                        }
                      >
                        {graph.characters.find((c) => c.id === other)?.name}
                      </button>{" "}
                      ·{" "}
                      <button
                        onClick={() =>
                          onSelect({ kind: "relationship", id: r.id })
                        }
                      >
                        {r.relationship_type}
                      </button>
                    </p>
                  );
                })}
            </section>
          </>
        )}
        {relationship && (
          <section>
            <h3>
              {
                graph.characters.find(
                  (c) => c.id === relationship.source_character_id,
                )?.name
              }{" "}
              →{" "}
              {
                graph.characters.find(
                  (c) => c.id === relationship.target_character_id,
                )?.name
              }
            </h3>
            <label>
              关系类型
              <input
                value={relationship.relationship_type}
                onChange={(e) =>
                  change({ ...relationship, relationship_type: e.target.value })
                }
              />
            </label>
            <label>
              方向
              <select
                value={relationship.direction}
                onChange={(e) =>
                  change({
                    ...relationship,
                    direction: e.target.value as Relationship["direction"],
                  })
                }
              >
                <option value="undirected">无方向</option>
                <option value="directed">单向</option>
                <option value="mutual">双向</option>
              </select>
            </label>
            <label>
              关系状态
              <input
                value={relationship.status ?? ""}
                onChange={(e) =>
                  change({ ...relationship, status: e.target.value })
                }
              />
            </label>
            <label>
              关系描述
              <textarea
                value={relationship.description ?? ""}
                onChange={(e) =>
                  change({ ...relationship, description: e.target.value })
                }
              />
            </label>
            <h3>关系时间线</h3>
            {relationship.events?.map((event, i) => (
              <p key={i}>
                {event.sequence} · {event.description}
              </p>
            ))}
          </section>
        )}
        {draft && (
          <EvidenceList
            projectId={projectId}
            storyId={storyId}
            ids={[...new Set(refs)]}
          />
        )}
      </div>
      <footer>
        <p role="status">{message}</p>
        <Button disabled={!draft || pending} onClick={submit}>
          保存
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => {
            dirty.current = false;
            setDraft(query.data ?? null);
            onDirty(false);
            setMessage("");
          }}
        >
          取消编辑
        </Button>
        <button disabled={pending} onClick={destroy}>
          删除
        </button>
      </footer>
    </aside>
  );
}
