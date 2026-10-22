import { useQuery } from "@tanstack/react-query";
import { Navigate, Link } from "react-router";
import { read, root, type Production } from "./api";
export function LegacyProductionRoute({
  projectId,
  productionId,
}: {
  projectId: string;
  productionId?: string;
}) {
  const query = useQuery({
    queryKey: ["projects", projectId, "legacy-production", productionId],
    queryFn: ({ signal }) =>
      read<Production>(root(projectId) + "/" + productionId, signal),
    enabled: !!productionId,
  });
  if (!productionId)
    return <Navigate replace to={`/projects/${projectId}/stories`} />;
  if (query.isPending)
    return <p className="production-empty">正在定位所属故事…</p>;
  if (!query.data)
    return (
      <div className="production-empty">
        <p>无法读取此制作任务，数据未被删除。请确认访问权限或重试。</p>
        <button onClick={() => void query.refetch()}>重试</button>
        <Link to={`/projects/${projectId}/stories`}>返回故事列表</Link>
      </div>
    );
  return (
    <Navigate
      replace
      to={`/projects/${projectId}/stories/${query.data.story_id}/video-productions/${productionId}`}
    />
  );
}
