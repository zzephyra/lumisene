import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Settings, HardDrive, CheckCircle2, RefreshCw, ChevronDown, Check, Info, Save, Cloud, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { isApiError, userFacingMessage } from "../../lib/api";
import { useSession } from "../auth";
import {
  readSystemSettings,
  saveSystemSettings,
  type DeletionPolicy,
} from "./system-settings-api";

const COPY: Record<DeletionPolicy, string> = {
  retain_cloud_file: "从作品列表隐藏，并保留删除记录。七牛云上的文件继续保留，不会自动清理。",
  delete_cloud_file: "从作品列表隐藏后，由后台任务删除对应的七牛云文件。清理失败会保持失败状态，不会显示为已经永久删除。",
};

export function SystemSettingsScreen() {
  const session = useSession();
  const client = useQueryClient();
  const [draft, setDraft] = useState<DeletionPolicy | null>(null);
  const [draftRevision, setDraftRevision] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["admin", "system-settings", session.data?.id],
    queryFn: ({ signal }) => readSystemSettings(signal),
  });
  const current = query.data;
  const selected = draft ?? current?.assets.deletion_policy ?? "retain_cloud_file";
  const save = useMutation({
    mutationFn: () => saveSystemSettings(draftRevision ?? current?.revision ?? 0, selected),
    onSuccess: async (saved) => {
      setDraft(null);
      setDraftRevision(null);
      setError("");
      setNotice("已保存。后续删除会使用这个策略，不需要重启。");
      await client.setQueryData(["admin", "system-settings", session.data?.id], saved);
    },
    onError: (reason) => {
      setNotice("");
      setError(
        isApiError(reason) && reason.status === 409
          ? "设置已被其他管理员更新，请刷新后再保存。"
          : userFacingMessage(reason),
      );
    },
  });
  const dirty = Boolean(current && selected !== current.assets.deletion_policy);
  const reset = () => { setDraft(null); setDraftRevision(null); setError(""); setNotice(""); };
  return (
    <section className="admin-page system-settings-page">
      <div className="admin-page-heading">
        <div><span className="settings-eyebrow">WORKSPACE ADMINISTRATION</span><h1>系统设置</h1><p>管理存储设置规则，让每一次操作都有明确的边界。</p></div>
        <span className="settings-live"><span />保存后即时生效</span>
      </div>
      <div className="settings-layout settings-categorized">
        <nav className="settings-category-nav" aria-label="设置分类">
          <span className="settings-nav-group">系统偏好</span>
          <button type="button" aria-current="page"><HardDrive size={17} /><span>存储</span>{dirty && <span className="settings-unsaved-dot" aria-label="有未保存的更改" />}</button>
          <div className="settings-nav-note"><Settings size={15} /><span>更改仅在保存后生效</span></div>
        </nav>
        <div className="settings-category-content">
        <div className="settings-category-heading"><h2>存储</h2><p>管理作品删除及云端文件保留规则。</p></div>
        <div className="settings-main">
          {query.isLoading && <div className="settings-card settings-loading" role="status"><RefreshCw size={22} /><p>正在读取系统设置…</p></div>}
          {query.isError && <div className="settings-card settings-load-error" role="alert"><h2>无法读取系统设置</h2><p>{userFacingMessage(query.error)}</p><Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} />重新加载</Button></div>}
          {current && <form className="settings-card" onSubmit={event => { event.preventDefault(); if (!dirty || save.isPending) return; setNotice(""); setError(""); save.mutate(); }}>
            <div className="settings-card-heading"><span className="settings-symbol"><HardDrive size={22} /></span><div><h2>存储设置</h2><p>设置删除作品后，云端原文件的处理方式。</p></div></div>
            <div className="settings-card-body">
              <label className="settings-field" htmlFor="asset-deletion-policy"><span>作品删除策略</span><small>适用于保存设置后发起的删除操作</small></label>
              <DropdownMenu.Root>
                <DropdownMenu.Trigger id="asset-deletion-policy" className="settings-select settings-custom-select" disabled={save.isPending} aria-describedby="deletion-policy-description">
                  <span>{selected === "retain_cloud_file" ? "保留云端文件" : "同步清理云端文件"}</span><ChevronDown size={16} aria-hidden="true" />
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal><DropdownMenu.Content className="settings-select-menu" align="start" sideOffset={6} collisionPadding={12}>
                  <DropdownMenu.RadioGroup value={selected} onValueChange={value => { setDraftRevision(draftRevision ?? current.revision); setDraft(value as DeletionPolicy); setNotice(""); setError(""); }}>
                    {([ ["retain_cloud_file", "保留云端文件"], ["delete_cloud_file", "同步清理云端文件"] ] as const).map(([value, label]) => <DropdownMenu.RadioItem className="settings-select-option" key={value} value={value}><span className="settings-option-check"><DropdownMenu.ItemIndicator><Check size={16} /></DropdownMenu.ItemIndicator></span>{label}</DropdownMenu.RadioItem>)}
                  </DropdownMenu.RadioGroup>
                </DropdownMenu.Content></DropdownMenu.Portal>
              </DropdownMenu.Root>
              <div className="settings-policy-preview" id="deletion-policy-description">{selected === "retain_cloud_file" ? <Cloud size={20} /> : <Trash2 size={20} />}<div><strong>{selected === "retain_cloud_file" ? "保留文件，仅移除作品" : "移除作品，并清理云端文件"}</strong><p>{COPY[selected]}</p></div></div>
              <div className="settings-info"><Info size={16} /><p>已排队的清理任务仍按创建时的策略执行。切换策略不会追溯清理之前保留的文件。</p></div>
              {notice && <div className="settings-feedback is-success" role="status"><CheckCircle2 size={17} />{notice}</div>}
              {error && <div className="settings-feedback is-error" role="alert"><p>{error}</p>{isApiError(save.error) && save.error.status === 409 && <Button variant="outline" type="button" disabled={query.isFetching} onClick={() => { reset(); void query.refetch(); }}>加载最新设置</Button>}</div>}
            </div>
            <footer className="settings-save-bar"><span className={dirty ? "is-dirty" : ""}>{dirty ? "有尚未保存的修改" : "所有设置已同步"}</span><div><Button variant="outline" type="button" disabled={!dirty || save.isPending} onClick={reset}>重置更改</Button><Button disabled={save.isPending || !dirty || query.isFetching} type="submit"><Save size={15} />{save.isPending ? "正在保存…" : "保存更改"}</Button></div></footer>
          </form>}
        </div>

        </div>
      </div>
    </section>
  );
}
