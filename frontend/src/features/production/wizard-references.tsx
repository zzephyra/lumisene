import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { graph } from "../character-graph/api";
import { listResources, libraryOptions } from "../story-assets/api";
import { AssetUploadDialog } from "../story-assets/upload-dialog";
import { Button } from "../../components/ui/button";
import {
  read,
  type CharacterImages,
  type Settings,
  type Source,
  type Selection,
} from "./api";
function CharacterReference({
  projectId,
  storyId,
  id,
  name,
  value,
  onChange,
}: {
  projectId: string;
  storyId: string;
  id: string;
  name: string;
  value: string | null | undefined;
  onChange: (id: string | null) => void;
}) {
  const query = useQuery({
    queryKey: [
      "projects",
      projectId,
      "stories",
      storyId,
      "character-images",
      id,
    ],
    queryFn: ({ signal }) =>
      read<CharacterImages>(
        `/api/v1/projects/${projectId}/stories/${storyId}/characters/${id}/images`,
        signal,
      ),
  });
  return (
    <article className="production-reference-person">
      <h3>{name}</h3>
      {!!query.data?.images.length && (
        <div className="production-reference-grid">
          {query.data.images.map((image) => (
            <button
              key={image.id}
              aria-label={`选择${name}的形象`}
              aria-pressed={
                value === image.id || (value === undefined && image.is_primary)
              }
              onClick={() => onChange(image.id)}
            >
              <img src={image.image_url} alt={name} />
              {image.is_primary && <small>主形象</small>}
            </button>
          ))}
        </div>
      )}
      {query.isError && (
        <Button onClick={() => void query.refetch()}>图片加载失败，重试</Button>
      )}
      <Button
        variant="ghost"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
      >
        仅使用人物描述
      </Button>
      <Link
        target="_blank"
        rel="noreferrer"
        to={`/projects/${projectId}/stories/${storyId}/relations?character=${id}`}
      >
        管理或生成人物形象 ↗
      </Link>
    </article>
  );
}
export function WizardReferences({
  projectId,
  storyId,
  source,
  selections,
  value,
  onChange,
}: {
  projectId: string;
  storyId: string;
  source: Source;
  selections: Selection[];
  value: Settings;
  onChange: (s: Settings) => void;
}) {
  const [upload, setUpload] = useState(false);
  const people = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "graph"],
    queryFn: ({ signal }) => graph(projectId, storyId, signal),
  });
  const assets = useQuery({
    queryKey: [
      "projects",
      projectId,
      "stories",
      storyId,
      "resources",
      "wizard",
    ],
    queryFn: ({ signal }) =>
      listResources(
        projectId,
        storyId,
        { category: "all", limit: 60 },
        signal,
      ),
  });
  const options = useQuery({
    queryKey: ["projects", projectId, "stories", storyId, "resource-options"],
    queryFn: ({ signal }) => libraryOptions(projectId, storyId, signal),
  });
  const scenes = source.chapters.flatMap((c) => {
    const sel = selections.find((s) => s.chapter_id === c.id);
    return sel
      ? c.scenes
          .filter((s) => sel.scene_ids == null || sel.scene_ids.includes(s.id))
          .map((s) => ({ ...s, chapter: c.title }))
      : [];
  });
  const ids = new Set(scenes.flatMap((s) => s.character_ids ?? []));
  const images = (assets.data?.items ?? []).filter((item) => item.kind === "image");
  return (
    <div className="production-wizard-references">
      <h2>确认人物与场景</h2>
      <p className="text-muted">
        基于选中章节关联的人物
        ID。当前视频模型每次使用一张参考图；人物与环境都有参考时优先人物，环境以文字参与描述。
      </p>
      {people.isError && <p role="alert">人物加载失败，请刷新重试。</p>}
      {people.data?.characters
        .filter((p) => ids.has(p.id))
        .map((p) => (
          <CharacterReference
            key={p.id}
            projectId={projectId}
            storyId={storyId}
            id={p.id}
            name={p.name}
            value={value.character_references?.[p.id]}
            onChange={(id) =>
              onChange({
                ...value,
                character_references: {
                  ...value.character_references,
                  [p.id]: id,
                },
              })
            }
          />
        ))}
      {!ids.size && (
        <p>选中剧情尚未关联人物，可直接继续或在剧情编辑器中补充。</p>
      )}
      <h3>场景环境参考</h3>
      <Button variant="outline" onClick={() => setUpload(true)}>
        上传环境图片到故事资源
      </Button>
      {assets.isError && (
        <Button variant="ghost" onClick={() => void assets.refetch()}>
          参考图加载失败，重试
        </Button>
      )}
      {scenes.map((scene) => (
        <article className="production-reference-person" key={scene.id}>
          <h3>
            {scene.title} · {scene.chapter}
          </h3>
          <p>{scene.summary}</p>
          {images.length > 0 && (
            <fieldset>
              <legend>
                环境参考（最多 8 张，首张用于单图模型；未选时使用文字）
              </legend>
              <div className="production-reference-grid">
                {images.map((a) => {
                  const refs = value.scene_references?.[scene.id] ?? [];
                  const index = refs.findIndex(
                    (r) => r.source === a.source && r.id === a.id,
                  );
                  return (
                    <button
                      key={`${a.source}:${a.id}`}
                      type="button"
                      aria-label={a.name}
                      aria-pressed={index >= 0}
                      disabled={index < 0 && refs.length >= 8}
                      onClick={() =>
                        onChange({
                          ...value,
                          scene_references: {
                            ...value.scene_references,
                            [scene.id]:
                              index >= 0
                                ? refs.filter((_, i) => i !== index)
                                : [...refs, { source: a.source, id: a.id }],
                          },
                        })
                      }
                    >
                      <img
                        src={a.thumbnail_url ?? a.preview_url}
                        alt={a.name}
                        loading="lazy"
                      />
                      <small>
                        {index >= 0 ? `${index + 1} · ` : ""}
                        {a.name}
                      </small>
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
        </article>
      ))}
      <AssetUploadDialog
        open={upload}
        projectId={projectId}
        storyId={storyId}
        options={options.data}
        session={0}
        initialFiles={EMPTY_FILES}
        onClose={() => {
          setUpload(false);
          void assets.refetch();
        }}
      />
    </div>
  );
}
const EMPTY_FILES: File[] = [];
