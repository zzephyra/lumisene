import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Navigate } from "react-router";
import { Plus, Puzzle, Pencil, Power, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "../../components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { isApiError, userFacingMessage } from "../../lib/api";
import { useSession } from "../auth";
import {
  listSkills,
  saveSkill,
  operateSkill,
  type Skill,
  type SkillDraft,
} from "./skills-api";
import {
  Confirmation,
  FilterSelect,
  Pagination,
  QueryMessage,
  formatTime,
} from "./operations-shared";
const empty: SkillDraft = { slug: "", name: "", description: "", content: "" };
export function SkillsScreen() {
  const session = useSession(),
    client = useQueryClient();
  const [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(0);
  const [editor, setEditor] = useState<{
      row?: Skill;
      readonly?: boolean;
    } | null>(null),
    [draft, setDraft] = useState<SkillDraft>(empty);
  const [target, setTarget] = useState<{
      row: Skill;
      action: "toggle" | "delete";
    } | null>(null),
    [notice, setNotice] = useState("");
  const query = useQuery({
    queryKey: ["admin", "skills", session.data?.id, search, status, page],
    queryFn: ({ signal }) => listSkills(search, status, page, signal),
    enabled: !!session.data,
    retry: false,
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: ["admin", "skills"] });
  const save = useMutation({
    mutationFn: () => saveSkill(draft, editor?.row),
    onSuccess: async () => {
      setEditor(null);
      setNotice("技能已保存");
      await refresh();
    },
  });
  const action = useMutation({
    mutationFn: () => operateSkill(target!.row, target!.action),
    onSuccess: async () => {
      setTarget(null);
      setNotice("技能状态已更新");
      await refresh();
    },
  });
  function open(row?: Skill, readonly = false) {
    save.reset();
    setDraft(
      row
        ? {
            runtime_key: row.runtime_key as SkillDraft["runtime_key"],
            slug: row.slug,
            name: row.name,
            description: row.description,
            content: row.content,
          }
        : empty,
    );
    setEditor({ row, readonly });
  }
  if (isApiError(query.error) && query.error.status === 404)
    return <Navigate replace to="/studio" />;
  return (
    <>
      <div className="admin-page-heading">
        <div>
          <h1>技能管理</h1>
          <p>维护可复用的创作指令，每次更改保留版本记录。</p>
        </div>
        <Button onClick={() => open()}>
          <Plus size={16} />
          新增技能
        </Button>
      </div>
      <div className="skill-intro">
        <Puzzle size={24} />
        <div>
          <strong>让创作经验成为可复用的技能</strong>
          <p>
            关联扩图能力并激活后，技能指令会用于新扩图任务。停用关联技能会阻止新扩图；未关联的技能仅保存在目录。
          </p>
        </div>
      </div>
      {notice && <p role="status">{notice}</p>}
      <form
        className="admin-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(q);
          setPage(0);
        }}
      >
        <Input
          aria-label="搜索技能"
          placeholder="搜索技能名称或标识…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <Button variant="outline" type="submit">
          搜索
        </Button>
        <FilterSelect
          label="状态"
          value={status}
          onChange={(v) => {
            setStatus(v);
            setPage(0);
          }}
          options={{ "": "全部状态", true: "已激活", false: "已停用" }}
        />
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          刷新
        </Button>
      </form>
      <QueryMessage
        pending={query.isPending}
        error={query.error}
        empty={query.data?.items.length === 0}
        retry={() => void query.refetch()}
      />
      {query.data && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>技能 / 标识</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>更新时间</TableHead>
                <TableHead>操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <button
                      className="skill-title"
                      onClick={() => open(row, true)}
                    >
                      {row.name}
                    </button>
                    <div className="skill-muted">
                      {row.slug}
                      {row.runtime_key ? ` · ${row.runtime_key}` : ""}
                    </div>
                    <div className="skill-summary">{row.description}</div>
                  </TableCell>
                  <TableCell>
                    <span
                      className={`skill-status ${row.enabled ? "is-active" : ""}`}
                    >
                      {row.enabled ? "已激活" : "已停用"}
                    </span>
                  </TableCell>
                  <TableCell>v{row.version}</TableCell>
                  <TableCell>{formatTime(row.updated_at)}</TableCell>
                  <TableCell>
                    <div className="skill-row-actions">
                      <Button variant="outline" onClick={() => open(row)}>
                        <Pencil size={14} />
                        编辑
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          action.reset();
                          setTarget({ row, action: "toggle" });
                        }}
                      >
                        <Power size={14} />
                        {row.enabled ? "停用" : "激活"}
                      </Button>
                      <Button
                        variant="outline"
                        aria-label={`删除 ${row.name}`}
                        onClick={() => {
                          action.reset();
                          setTarget({ row, action: "delete" });
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination
            page={page}
            total={query.data.total}
            busy={query.isFetching}
            onChange={setPage}
          />
        </>
      )}
      <Dialog
        open={!!editor}
        onOpenChange={(v) => {
          if (!v && !save.isPending) setEditor(null);
        }}
      >
        <DialogContent className="admin-surface skill-dialog">
          <DialogTitle className="admin-dialog-title">
            {editor?.readonly
              ? "技能详情"
              : editor?.row
                ? "编辑技能"
                : "新增技能"}
          </DialogTitle>
          <DialogDescription className="admin-dialog-description">
            {editor?.row
              ? `${editor.row.slug} · v${editor.row.version}`
              : "保存后为停用状态，确认内容后可激活。"}
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <fieldset disabled={save.isPending || editor?.readonly}>
              <label>
                名称
                <Input
                  required
                  maxLength={120}
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>
              <label>
                唯一标识
                <Input
                  required
                  disabled={!!editor?.row}
                  pattern="[a-z0-9]+(-[a-z0-9]+)*"
                  maxLength={80}
                  placeholder="cinematic-storyboard"
                  value={draft.slug}
                  onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
                />
              </label>
              <label>
                关联能力
                <select
                  value={draft.runtime_key ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      runtime_key:
                        e.target.value === "image.outpainting"
                          ? "image.outpainting"
                          : null,
                    })
                  }
                >
                  <option value="">仅保存到目录</option>
                  <option value="image.outpainting" disabled>
                    旧扩图绑定（已停用）
                  </option>
                </select>
                <small>
                  每种能力只能关联一个技能。内置扩图约束始终生效；新建后请激活。
                </small>
              </label>
              <label>
                简介
                <Input
                  maxLength={1000}
                  value={draft.description}
                  onChange={(e) =>
                    setDraft({ ...draft, description: e.target.value })
                  }
                />
              </label>
              <label>
                技能正文 · Markdown
                <textarea
                  required
                  rows={12}
                  maxLength={30000}
                  value={draft.content}
                  onChange={(e) =>
                    setDraft({ ...draft, content: e.target.value })
                  }
                />
              </label>
            </fieldset>
            {save.error && <p role="alert">{userFacingMessage(save.error)}</p>}
            <div className="skill-row-actions">
              <Button
                type="button"
                variant="outline"
                disabled={save.isPending}
                onClick={() => setEditor(null)}
              >
                关闭
              </Button>
              {!editor?.readonly && (
                <Button type="submit" disabled={save.isPending}>
                  {save.isPending ? "保存中…" : "保存技能"}
                </Button>
              )}
            </div>
          </form>
        </DialogContent>
      </Dialog>
      {target && (
        <Confirmation
          title={
            target.action === "delete"
              ? "删除技能"
              : target.row.enabled
                ? "停用技能"
                : "激活技能"
          }
          description={
            target.action === "delete"
              ? `删除「${target.row.name}」后将从目录移除，历史版本仍保留。若关联扩图，将解除绑定并恢复内置技能。`
              : `确认${target.row.enabled ? "停用" : "激活"}「${target.row.name}」？${target.row.runtime_key ? " 这将影响新扩图任务；已排队任务不受影响。" : ""}`
          }
          busy={action.isPending}
          error={action.error}
          close={() => setTarget(null)}
          confirm={() => action.mutate()}
        />
      )}
    </>
  );
}
