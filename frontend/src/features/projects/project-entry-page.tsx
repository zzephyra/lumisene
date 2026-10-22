import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Navigate, useNavigate, useParams } from "react-router";

import { Button } from "../../components/ui/button";
import { isApiError, userFacingMessage } from "../../lib/api";
import { getProject, projectDetailQueryKey } from "./api";
import { isProjectId } from "./types";
import { Workspace } from "./workspace/workspace";

export function ProjectEntryPage() {
  const params = useParams();
  const projectId = params.projectId ?? "";
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const validId = isProjectId(projectId);
  const project = useQuery({
    queryKey: projectDetailQueryKey(projectId),
    queryFn: ({ signal }) => getProject(projectId, signal),
    enabled: validId,
    retry: false,
  });
  const missing =
    isApiError(project.error) && (project.error.status === 404 || project.error.status === 422);

  useEffect(() => {
    if (!missing) {
      return;
    }
    queryClient.removeQueries({ queryKey: ["projects", projectId] });
    navigate("/studio", { replace: true });
  }, [missing, navigate, projectId, queryClient]);

  if (!validId || missing) {
    return <Navigate replace to="/studio" />;
  }

  if (project.isSuccess) return <Workspace key={projectId} project={project.data} />;

  return (
    <div className="studio">
      <main className="mx-auto flex w-full max-w-[760px] flex-col gap-6 px-[6%] py-16 md:px-[5%]">
        {project.isPending ? (
          <p className="flex items-center gap-2 text-muted" role="status">
            <LoaderCircle aria-hidden className="size-4 animate-spin" />
            正在打开创作空间
          </p>
        ) : null}
        {project.isError && !missing ? (
          <section className="flex flex-col items-start gap-4 rounded-[14px] border border-line bg-panel p-8" role="alert">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-danger">
              <CircleAlert aria-hidden className="size-5" />
              无法打开创作空间
            </h1>
            <p className="text-muted">{userFacingMessage(project.error)}</p>
            <Button onClick={() => void project.refetch()} type="button" variant="outline">
              重试
            </Button>
          </section>
        ) : null}

      </main>
    </div>
  );
}
