import { useEffect, useState } from "react";
import { apiRequest } from "../../../lib/api";
import { isRecord } from "../../../lib/record";

export function OutpaintDebugLink({projectId,taskId}:{projectId:string;taskId?:string}) {
  const [assetId,setAssetId] = useState<string | null>(null);
  useEffect(() => {
    setAssetId(null);
    if (!taskId) return;
    const controller = new AbortController();
    apiRequest({path:`/api/v1/projects/${projectId}/generation-tasks/${taskId}/outpaint-debug`,signal:controller.signal}).then(body => {
      if (!controller.signal.aborted && isRecord(body) && typeof body.asset_id === "string") setAssetId(body.asset_id);
    }).catch(() => { /* Debug availability must not interrupt normal result preview. */ });
    return () => controller.abort();
  },[projectId,taskId]);
  return assetId ? <a className="outpaint-debug-download" href={`/api/v1/projects/${projectId}/assets/${encodeURIComponent(assetId)}/content`} download="outpaint-debug.zip">下载扩图调试包</a> : null;
}
