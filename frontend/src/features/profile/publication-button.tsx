import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Globe, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription } from "../../components/ui/alert-dialog";
import { isApiError, userFacingMessage } from "../../lib/api";
import { setPublication, type WorkPublication } from "./works-api";

export function PublicationButton({ projectId, publication }: { projectId: string; publication: WorkPublication }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const mutation = useMutation({
    mutationFn: () => setPublication(projectId, publication.id, !publication.public),
    onSuccess: result => {
      client.setQueriesData<WorkPublication[]>({ queryKey: ["work-publications"] }, rows => rows?.map(row => row.id === result.id ? result : row));
      setOpen(false);
      void client.invalidateQueries({ queryKey: ["work-publications"] });
      void client.invalidateQueries({ queryKey: ["public-works"] });
    },
  });
  if (!publication.can_publish) return publication.public ? <span>已公开</span> : null;
  return <>
    <Button className="asset-publication-button" variant="ghost" onClick={() => { mutation.reset(); setOpen(true); }}>
      {publication.public ? <Globe size={14} /> : <LockKeyhole size={14} />}{publication.public ? "已公开 · 撤回" : "私密 · 公开"}
    </Button>
    <AlertDialog open={open} onOpenChange={value => { if (!mutation.isPending) setOpen(value); }}><AlertDialogContent>
      <AlertDialogTitle>{publication.public ? "撤回公开作品？" : "公开这件作品？"}</AlertDialogTitle>
      <AlertDialogDescription>{publication.public ? "作品将从公开主页移除。已签发的临时媒体链接最多仍可访问 5 分钟。" : "任何人都可以在你的个人主页查看这件作品。原始提示词和项目资料不会公开，你可以随时撤回。"}</AlertDialogDescription>
      {mutation.isError && <p role="alert">{isApiError(mutation.error) && mutation.error.status === 404 ? "作品不存在或你已无权公开此作品，请刷新列表。" : userFacingMessage(mutation.error)}</p>}
      <div className="work-delete-actions"><Button variant="outline" disabled={mutation.isPending} onClick={() => setOpen(false)}>取消</Button><Button disabled={mutation.isPending} onClick={() => mutation.mutate()}>{mutation.isPending ? "正在保存…" : publication.public ? "确认撤回" : "确认公开"}</Button></div>
    </AlertDialogContent></AlertDialog>
  </>;
}
