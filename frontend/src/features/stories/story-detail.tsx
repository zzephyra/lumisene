import { StoryFilms } from "../production/story-films";
import { CreateProductionWizard } from "../production/create-wizard";
import {
  ArrowLeft,
  Ellipsis,
  Pencil,
  Clapperboard,
  Users,
  BookOpen,
  FolderOpen,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../components/ui/dropdown-menu";
import "./story-detail.css";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router";
import { Button } from "../../components/ui/button";
import { isApiError } from "../../lib/api";
import { StoryAssetLibrary } from "../story-assets/library";
import { StorylinePage } from "../storyline/storyline-page";
import { CharacterGraph } from "../character-graph/character-graph";
import { getStory, updateStory, type StoryInput } from "./api";
import { StoryDialog } from "./story-dialog";
import { StoryOverviewSkeleton } from "./story-overview";

const sections = [
  { id: "relations", label: "人物关系", path: "/relations", icon: Users },
  { id: "plot", label: "剧情", path: "/plot", icon: BookOpen },
  { id: "resources", label: "资源", path: "/resources", icon: FolderOpen },
  { id: "films", label: "成片", path: "/films", icon: Clapperboard },
] as const;

export function StoryDetail({
  projectId,
  storyId,
  section,
}: {
  projectId: string;
  storyId: string;
  section: string;
}) {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const query = useQuery({
    queryKey: ["projects", projectId, "stories", storyId],
    queryFn: ({ signal }) => getStory(projectId, storyId, signal),
  });
  const [creatingVideo, setCreatingVideo] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const story = query.data;
  const current = sections.some((item) => item.id === section)
    ? section
    : "plot";
  const root = `/projects/${projectId}/stories/${storyId}`;

  async function save(value: StoryInput) {
    if (!story) return;
    setPending(true);
    setError("");
    try {
      await updateStory(projectId, story.id, {
        ...value,
        expected_version: story.version,
      });
      await query.refetch();
      await queryClient.invalidateQueries({
        queryKey: ["projects", projectId, "stories"],
      });
      setEditing(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "保存失败");
      if (isApiError(reason) && reason.code === "version_conflict")
        await query.refetch();
    } finally {
      setPending(false);
    }
  }

  if (section === "overview") return <Navigate replace to={`${root}/plot`} />;
  return (
    <section className="story-detail flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <header className="story-header">
        <div className="story-context">
          <Link
            aria-label="返回故事"
            title="返回故事"
            className="story-icon"
            to={`/projects/${projectId}/stories`}
          >
            <ArrowLeft size={18} />
          </Link>
          <h1 title={story?.title}>{story?.title ?? "故事"}</h1>
        </div>
        <nav className="story-tabs" aria-label="故事内容">
          {sections.map((item) => (
            <Link
              key={item.id}
              aria-current={current === item.id ? "page" : undefined}
              to={`${root}${item.path}`}
            >
              <item.icon size={18} aria-hidden="true" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="story-actions">
          {story && (
            <Button
              className="story-generate-button h-8 px-3"
              onClick={() => setCreatingVideo(true)}
            >
              <Clapperboard size={17} />
              生成视频
            </Button>
          )}
          {current === "relations" && <div id="story-graph-tools" />}
          {story && current !== "relations" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  className="story-icon"
                  aria-label="更多操作"
                  title="更多操作"
                >
                  <Ellipsis size={17} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={() => {
                    setError("");
                    setEditing(true);
                  }}
                >
                  <Pencil size={16} />
                  故事设置
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>
      <div className="story-workspace-content">
        {query.isPending && (
          <div className="story-overview-scroll">
            <StoryOverviewSkeleton />
          </div>
        )}
        {query.isError && (
          <div className="story-overview-scroll" role="alert">
            <div className="story-overview">
              <p>故事加载失败</p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => void query.refetch()}
              >
                重试
              </Button>
            </div>
          </div>
        )}
        {story && (
          <>
            {current === "films" && (
              <StoryFilms
                projectId={projectId}
                storyId={story.id}
                onCreate={() => setCreatingVideo(true)}
              />
            )}
            {current === "relations" && (
              <div className="min-h-0 flex-1">
                <CharacterGraph
                  projectId={projectId}
                  storyId={story.id}
                  focusCharacterId={params.get("character")}
                  onEditStory={() => {
                    setError("");
                    setEditing(true);
                  }}
                />
              </div>
            )}
            {current === "plot" && (
              <StorylinePage
                key={story.id}
                projectId={projectId}
                storyId={story.id}
              />
            )}
            {current === "resources" && (
              <StoryAssetLibrary projectId={projectId} storyId={story.id} />
            )}
          </>
        )}
      </div>
      {story && (
        <CreateProductionWizard
          key={story.id}
          projectId={projectId}
          storyId={story.id}
          storyTitle={story.title}
          open={creatingVideo}
          onClose={() => setCreatingVideo(false)}
        />
      )}
      <StoryDialog
        error={error}
        onClose={() => {
          if (!pending) {
            setEditing(false);
            setError("");
          }
        }}
        onSubmit={(value) => void save(value)}
        open={editing}
        pending={pending}
        story={story ?? null}
      />
    </section>
  );
}
