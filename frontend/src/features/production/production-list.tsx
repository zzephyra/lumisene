import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { Clapperboard, Plus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Select } from "../../components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import { listStories } from "../stories/api";
import { read, root, type Summary } from "./api";
import "./production.css";
export function ProductionList({ projectId }: { projectId: string }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [story, setStory] = useState("");
  const error = "";
  const pending = false;
  const query = useQuery({
    queryKey: ["projects", projectId, "productions"],
    queryFn: ({ signal }) => read<Summary[]>(root(projectId), signal),
  });
  const stories = useQuery({
    queryKey: ["projects", projectId, "stories", "production-picker"],
    queryFn: ({ signal }) => listStories(projectId, null, signal),
  });
  const selected = stories.data?.items.find((s) => s.id === story);
  function create() {
    if (story) navigate(`/projects/${projectId}/stories/${story}`);
  }
  return (
    <section className="production-list">
      <header>
        <div>
          <p className="text-muted">从剧本到成片</p>
          <h1>视频制作</h1>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} />
          从剧本开始制作
        </Button>
      </header>
      <p className="text-muted">
        规划分镜、确认画面、逐镜生成，再组织为完整视频。每个任务独立保留剧本快照。
      </p>
      {query.isPending ? (
        <p>正在加载制作任务…</p>
      ) : query.isError ? (
        <Button onClick={() => void query.refetch()}>加载失败，重试</Button>
      ) : !query.data?.length ? (
        <div className="production-empty">
          <Clapperboard size={36} />
          <h2>让故事进入画面</h2>
          <p>从已有剧本创建第一个视频制作任务。</p>
        </div>
      ) : (
        <div className="production-cards">
          {query.data.map((item) => (
            <Link
              key={item.id}
              to={`/projects/${projectId}/productions/${item.id}`}
            >
              <Clapperboard />
              <h2>{item.title}</h2>
              <small>
                分镜版本 {item.version} ·{" "}
                {new Date(item.updated_at).toLocaleString()}
              </small>
            </Link>
          ))}
        </div>
      )}
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <DialogTitle>从剧本开始制作</DialogTitle>
          <DialogDescription>
            保存当前剧本的内容快照，后续剧本修改不会自动覆盖分镜。
          </DialogDescription>
          <Select
            id="production-story"
            label="选择剧本"
            value={story}
            onChange={setStory}
            options={(stories.data?.items ?? []).map((s) => ({
              value: s.id,
              label: s.title,
            }))}
          />
          {stories.isError && (
            <Button onClick={() => void stories.refetch()}>重试加载剧本</Button>
          )}
          {selected && (
            <p className="text-muted">
              {selected.description || "暂无简介"} ·
              将读取已保存的剧情章节和场景
            </p>
          )}
          {error && <p role="alert">{error}</p>}
          <Button disabled={!story || pending} onClick={() => void create()}>
            {pending ? "正在创建…" : "打开剧本，选择制作内容"}
          </Button>
        </DialogContent>
      </Dialog>
    </section>
  );
}
