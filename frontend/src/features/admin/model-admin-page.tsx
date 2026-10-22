import { useSession } from "../auth/use-session";
import { ModelOperationTags, modelDetailsUrl } from "./model-presentation";
import { brand } from "../../brand";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Library,
  LoaderCircle,
  Menu,
  Monitor,
  MoreHorizontal,
  Plus,
  Power,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  Outlet,
  useLocation,
  useOutletContext,
} from "react-router";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";
import { Button } from "../../components/ui/button";
import { Field } from "../../components/ui/field";
import { LumiMark } from "../../components/brand/LumiLogo";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import "./admin.css";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { isApiError, userFacingMessage } from "../../lib/api";
import { cn } from "../../lib/cn";
import { AccountMenu } from "../auth";
import {
  assignModel,
  clearModelAssignment,
  createModelConfig,
  disableModelConfig,
  enableModelConfig,
  listModelAssignments,
  listModelCatalog,
  listModelConfigs,
  type ProviderModelOption,
  modelAdminQueryKey,
  modelAssignmentQueryKey,
  type CreateModelConfigInput,
  type ModelAssignment,
  type ModelConfig,
} from "./api";

const CAPABILITIES = [
  ["text_generation", "文本生成"],
  ["text_to_image", "图片生成"],
  ["text_to_video", "视频"],
  ["embedding", "向量"],
  ["speech_synthesis", "语音合成"],
  ["speech_recognition", "语音识别"],
] as const;

export const ASSIGNMENT_TOAST_MS = 2800;

import { ADMIN_GROUPS, ADMIN_MODULES } from "./admin-navigation";

type AdminContext = { items: ModelConfig[] };

export function ModelAdminPage() {
  const session = useSession();
  if (session.isPending) return <p role="status">正在检查权限…</p>;
  if (!session.data?.platform_admin) return <Navigate to="/studio" replace />;
  return <AdminWorkspace />;
}

function AdminWorkspace() {
  const configs = useQuery({
    queryKey: modelAdminQueryKey,
    queryFn: ({ signal }) => listModelConfigs(signal),
    retry: false,
  });

  if (isApiError(configs.error) && configs.error.status === 404) {
    return <Navigate replace to="/studio" />;
  }
  if (!configs.data) {
    return (
      <div className="admin-shell admin-loading" data-theme="light">
        {configs.isPending ? (
          <div role="status" aria-label="正在加载模型目录">
            <div className="admin-skeleton admin-skeleton-title" />
            {Array.from({ length: 6 }, (_, index) => (
              <div className="admin-skeleton admin-skeleton-row" key={index} />
            ))}
          </div>
        ) : (
          <div className="admin-empty">
            <CircleAlert size={24} />
            <h1>无法加载模型目录</h1>
            <p role="alert">{userFacingMessage(configs.error)}</p>
            <Button variant="outline" onClick={() => void configs.refetch()}>
              重试
            </Button>
          </div>
        )}
      </div>
    );
  }
  return (
    <AdminFrame>
      <Outlet context={{ items: configs.data } satisfies AdminContext} />
    </AdminFrame>
  );
}

export function useAdminItems() {
  return useOutletContext<AdminContext>().items;
}

export function CatalogScreen() {
  const items = useAdminItems();
  const assignments = useQuery({
    queryKey: modelAssignmentQueryKey,
    queryFn: ({ signal }) => listModelAssignments(signal),
    retry: false,
  });
  const assignedIds = new Set(
    assignments.data?.flatMap((item) =>
      item.model_config_id ? [item.model_config_id] : [],
    ) ?? [],
  );
  return <CatalogTable assignedIds={assignedIds} items={items} />;
}

export function AssignmentScreen() {
  const items = useAdminItems();
  const assignments = useQuery({
    queryKey: modelAssignmentQueryKey,
    queryFn: ({ signal }) => listModelAssignments(signal),
    retry: false,
  });
  return (
    <BusinessAssignments
      assignments={assignments.data}
      error={assignments.error}
      items={items}
      pending={assignments.isPending}
    />
  );
}

function AdminFrame({ children }: { children: ReactNode }) {
  const [navOpen, setNavOpen] = useState(false);
  const { pathname } = useLocation();
  const title = pathname.startsWith("/admin/models/details")
    ? "模型详情"
    : (ADMIN_MODULES.find((item) => item.path === pathname.replace(/\/$/, ""))
        ?.title ?? "控制台总览");
  const [theme, setTheme] = useState<"light" | "dark">("light");

  function sidebarContent() {
    return (
      <>
        <div className="flex h-16 items-center justify-between gap-3 px-5">
          <div className="flex items-center gap-3">
            <LumiMark className="size-7 text-primary" />
            <div>
              <p className="text-sm font-semibold tracking-tight text-ink">
                {brand.name}
              </p>
              <p className="text-[11px] tracking-[0.16em] text-muted">
                管理控制台
              </p>
            </div>
          </div>
        </div>
        <nav aria-label="管理导航" className="admin-navigation">
          {ADMIN_GROUPS.map((group) => (
            <div key={group}>
              <p className="admin-nav-label">{group}</p>
              {ADMIN_MODULES.filter((item) => item.group === group).map(
                ({ path, title, icon: Icon, planned }) => (
                  <Link
                    key={path}
                    to={path}
                    aria-current={
                      pathname.replace(/\/$/, "") === path ||
                      (path === "/admin/models" &&
                        pathname.startsWith("/admin/models/"))
                        ? "page"
                        : undefined
                    }
                    onClick={() => setNavOpen(false)}
                    className={cn(
                      "admin-navigation-link",
                      (pathname.replace(/\/$/, "") === path ||
                        (path === "/admin/models" &&
                          pathname.startsWith("/admin/models/"))) &&
                        "is-active",
                    )}
                  >
                    <Icon aria-hidden size={17} />
                    <span>{title}</span>
                    {planned && (
                      <span className="admin-nav-planned">待接入</span>
                    )}
                  </Link>
                ),
              )}
            </div>
          ))}
        </nav>
        <div className="admin-sidebar-footer">
          <Link to="/studio">
            <ArrowLeft size={16} /> 返回工作区
          </Link>
          <Button
            variant="ghost"
            onClick={() => setTheme(theme === "light" ? "dark" : "light")}
          >
            <Monitor size={16} /> 切换至{theme === "light" ? "深色" : "浅色"}
            模式
          </Button>
          <p>{brand.name} · 创作平台管理</p>
        </div>
      </>
    );
  }

  return (
    <div
      className="admin-shell min-h-svh md:grid md:grid-cols-[232px_minmax(0,1fr)]"
      data-theme={theme}
    >
      <aside className="admin-sidebar sticky top-0 hidden h-svh w-[232px] flex-col border-r border-line bg-panel md:flex">
        {sidebarContent()}
      </aside>
      <Dialog open={navOpen} onOpenChange={setNavOpen}>
        <DialogContent className="admin-surface admin-mobile-navigation">
          <DialogTitle className="sr-only">管理导航</DialogTitle>
          <DialogDescription className="sr-only">
            切换后台管理页面
          </DialogDescription>
          {sidebarContent()}
        </DialogContent>
      </Dialog>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-4 border-b border-line bg-panel px-4 md:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              aria-label="打开管理导航"
              className="md:hidden"
              onClick={() => setNavOpen(true)}
              type="button"
              variant="outline"
            >
              <Menu aria-hidden size={16} />
            </Button>
            <nav aria-label="面包屑" className="admin-breadcrumb">
              <span>控制台</span>
              <ChevronRight size={14} />
              <span aria-current="page">{title}</span>
            </nav>
          </div>
          <AccountMenu />
        </header>
        <main className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-4 py-6 md:px-8 md:py-8">
          <p className="sr-only" id="model-admin-note">
            登记和指定都不会向供应商发起调用。
          </p>
          {children}
        </main>
      </div>
    </div>
  );
}

const PARAMETER_LABELS: Record<string, string> = {
  resolutions: "清晰度",
  sizes: "尺寸",
  ratios: "画幅",
  duration: "时长",
  durations: "时长",
};

const INPUT_LABELS: Record<string, string> = {
  text: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
};

function catalogLabel(aliasZh: string, aliasEn: string, name: string) {
  const alias = aliasZh || aliasEn;
  return alias && alias !== name ? `${alias} · ${name}` : name;
}

function CreateModelForm({
  onCreated,
  onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const catalog = useQuery({
    queryKey: ["admin", "model-catalog"],
    queryFn: ({ signal }) => listModelCatalog(signal),
  });
  const providers = catalog.data ?? [];
  const [providerId, setProviderId] = useState("");
  const [modelName, setModelName] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const provider =
    providers.find((item) => item.id === providerId) ?? providers[0];
  const model =
    provider?.models.find((item) => item.name === modelName) ??
    provider?.models[0];
  const create = useMutation({
    mutationFn: createModelConfig,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: modelAdminQueryKey });
      await queryClient.invalidateQueries({
        queryKey: modelAssignmentQueryKey,
      });
    },
  });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider || !model || model.capabilities.length === 0) {
      return;
    }
    setFormError(null);
    try {
      for (const capability of model.capabilities) {
        const input: CreateModelConfigInput = {
          provider: provider.id,
          model_name: model.name,
          capability,
          parameters_schema: model.parameters,
          limits: {},
          secret_ref: provider.id,
        };
        await create.mutateAsync(input);
      }
      setProviderId("");
      setModelName("");
      onCreated();
    } catch (error) {
      setFormError(userFacingMessage(error));
    }
  }

  return (
    <form
      aria-describedby="model-admin-note"
      className="mt-4 flex flex-col gap-4"
      id="admin-create"
      onSubmit={(event) => void onSubmit(event)}
    >
      <h3 className="admin-form-section-title">基本信息</h3>
      {catalog.isPending ? <p role="status">正在读取供应商</p> : null}
      {catalog.isError ? <p role="alert">供应商目录没有载入</p> : null}
      {!catalog.isPending && !catalog.isError && providers.length === 0 ? (
        <p role="status">
          还没有可登记的供应商。请先在 model-endpoints.yaml
          写上别名、模型和参数。
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="model-provider" label="供应商">
          <Select
            id="model-provider"
            onChange={(next) => {
              setProviderId(next);
              setModelName("");
            }}
            options={providers.map((item) => ({
              value: item.id,
              label: catalogLabel(item.alias_zh, item.alias_en, item.id),
            }))}
            value={provider?.id ?? ""}
          />
        </Field>
        <Field id="model-name" label="模型">
          <Select
            id="model-name"
            onChange={setModelName}
            options={(provider?.models ?? []).map((item) => ({
              value: item.name,
              label: catalogLabel(item.alias_zh, item.alias_en, item.name),
            }))}
            value={model?.name ?? ""}
          />
        </Field>
      </div>
      {model ? (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <ModelOperationTags model={model} />
            {model.capabilities.map((value) => (
              <CapabilityTag key={value} value={value} />
            ))}
          </div>
          {model.inputs.length > 0 ? (
            <p className="admin-helper">
              输入：
              {model.inputs
                .map((value) => INPUT_LABELS[value] ?? value)
                .join("、")}
            </p>
          ) : null}
        </div>
      ) : null}
      {model && provider && (
        <Link
          className="admin-detail-back"
          to={modelDetailsUrl(provider.id, model.name)}
        >
          模型详情 →
        </Link>
      )}
      <ParameterChoices model={model} />
      {formError ? (
        <p className="text-sm text-danger" role="alert">
          {formError}
        </p>
      ) : null}
      <div className="admin-form-footer">
        <Button
          variant="outline"
          disabled={create.isPending}
          onClick={onCancel}
        >
          取消
        </Button>
        <Button
          className="min-w-28"
          disabled={create.isPending || !model}
          type="submit"
        >
          {create.isPending && (
            <LoaderCircle className="animate-spin" size={14} />
          )}
          {create.isPending ? "正在登记" : "确认登记"}
        </Button>
      </div>
    </form>
  );
}

function ParameterChoices({
  model,
}: {
  model: ProviderModelOption | undefined;
}) {
  const entries = Object.entries(model?.parameters ?? {});
  if (!model) {
    return null;
  }
  if (entries.length === 0) {
    return <p className="admin-helper">这个模型没有额外参数。</p>;
  }
  return (
    <div>
      <h3 className="admin-form-section-title">支持参数</h3>
      <ul className="admin-helper">
        {entries.map(([key, values]) => (
          <li key={key}>
            {PARAMETER_LABELS[key] ?? key}：
            {values
              .map((value) =>
                key === "durations" && value === -1
                  ? "智能时长"
                  : String(value),
              )
              .join("、")}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CatalogTable({
  items,
  assignedIds,
}: {
  items: ModelConfig[];
  assignedIds: Set<string>;
}) {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [tag, setTag] = useState("all");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const needle = query.trim().toLowerCase();
  const visible = items.filter(
    (item) =>
      (tag === "all" || item.capability === tag) &&
      (provider === "all" || item.provider === provider) &&
      (status === "all" || item.enabled === (status === "active")) &&
      (!needle || item.model_name.toLowerCase().includes(needle)),
  );
  const pages = Math.max(1, Math.ceil(visible.length / 10));
  const currentPage = Math.min(page, pages);
  const rows = visible.slice((currentPage - 1) * 10, currentPage * 10);
  const providers = [...new Set(items.map((item) => item.provider))].sort();
  const filtered = Boolean(
    query || tag !== "all" || provider !== "all" || status !== "all",
  );
  function resetFilters() {
    setQuery("");
    setTag("all");
    setProvider("all");
    setStatus("all");
    setPage(1);
  }
  async function refresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      await Promise.all([
        queryClient.refetchQueries(
          { queryKey: modelAdminQueryKey },
          { throwOnError: true },
        ),
        queryClient.refetchQueries(
          { queryKey: modelAssignmentQueryKey },
          { throwOnError: true },
        ),
      ]);
    } catch (error) {
      setRefreshError(userFacingMessage(error));
    } finally {
      setRefreshing(false);
    }
  }
  return (
    <section className="admin-catalog" id="admin-catalog">
      <div className="admin-page-heading">
        <div>
          <h1>Models</h1>
          <p>Manage model providers, configurations and availability.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={16} /> 登记模型
        </Button>
      </div>
      <div className="admin-overview" aria-label="模型目录概览">
        {[
          ["配置总数", items.length],
          ["已启用", items.filter((item) => item.enabled).length],
          ["供应商", providers.length],
          ["已停用", items.filter((item) => !item.enabled).length],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <div className="admin-section-heading">
        <h2>
          模型目录 <span>{items.length}</span>
        </h2>
        <span>管理已发布的模型配置版本</span>
      </div>
      <div className="admin-toolbar">
        <div className="admin-search">
          <Search size={16} />
          <Input
            aria-label="搜索模型名称"
            id="model-search"
            placeholder="搜索模型名称…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <div className="admin-filters">
          <CatalogFilter
            label="供应商"
            value={provider}
            options={providers.map((value) => [value, value])}
            onChange={(value) => {
              setProvider(value);
              setPage(1);
            }}
          />
          <CatalogFilter
            label="状态"
            value={status}
            options={[
              ["active", "已启用"],
              ["inactive", "已停用"],
            ]}
            onChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          />
          <CatalogFilter
            label="能力"
            value={tag}
            options={CAPABILITIES}
            onChange={(value) => {
              setTag(value);
              setPage(1);
            }}
          />
          {filtered && (
            <Button variant="ghost" onClick={resetFilters}>
              清除筛选
            </Button>
          )}
          <Button
            variant="outline"
            className="admin-icon-button"
            aria-label="刷新模型目录"
            title="刷新模型目录"
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <RefreshCw size={16} className={refreshing ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>
      {refreshError && (
        <p className="text-sm text-danger" role="alert">
          {refreshError}
        </p>
      )}
      {visible.length === 0 ? (
        <div className="admin-empty">
          <Library size={28} />
          <h3>{items.length === 0 ? "还没有登记模型" : "没有匹配的模型"}</h3>
          <p>
            {items.length === 0
              ? "登记后的模型配置将在这里展示。"
              : "尝试其他名称，或清除筛选条件。"}
          </p>
          <Button
            variant="outline"
            onClick={
              items.length === 0 ? () => setCreateOpen(true) : resetFilters
            }
          >
            {items.length === 0 ? "添加第一个模型" : "清除筛选条件"}
          </Button>
        </div>
      ) : (
        <>
          <Table aria-label="模型配置目录">
            <TableHeader>
              <TableRow className="border-t-0">
                <TableHead>模型 / 供应商</TableHead>
                <TableHead>能力</TableHead>
                <TableHead>版本</TableHead>
                <TableHead>密钥名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">操作</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => (
                <ModelConfigRow
                  key={item.id}
                  assigned={assignedIds.has(item.id)}
                  item={item}
                />
              ))}
            </TableBody>
          </Table>
          <div className="admin-pagination">
            <span>
              共 {visible.length} 条配置 · 第 {(currentPage - 1) * 10 + 1}–
              {Math.min(currentPage * 10, visible.length)} 条
            </span>
            <div>
              <Button
                variant="outline"
                aria-label="上一页"
                title="上一页"
                disabled={currentPage === 1}
                onClick={() => setPage(currentPage - 1)}
              >
                <ChevronLeft size={16} />
              </Button>
              <span>
                {currentPage} / {pages}
              </span>
              <Button
                variant="outline"
                aria-label="下一页"
                title="下一页"
                disabled={currentPage === pages}
                onClick={() => setPage(currentPage + 1)}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
        </>
      )}
      <p className="admin-footnote">
        已发布的配置不可编辑。停用后可以恢复，但不会自动恢复业务指定。登记操作不会调用供应商。
      </p>
      <Dialog onOpenChange={setCreateOpen} open={createOpen}>
        <DialogContent className="admin-surface admin-model-dialog">
          <DialogTitle className="admin-dialog-title">登记模型</DialogTitle>
          <DialogDescription className="admin-dialog-description">
            从已配置的供应商中选择模型和参数。只保存密钥名称，不保存密钥本身。
          </DialogDescription>
          <CreateModelForm
            onCreated={() => setCreateOpen(false)}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CatalogFilter({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly (readonly [string, string])[];
  onChange: (value: string) => void;
}) {
  const selected = options.find((option) => option[0] === value)?.[1];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          aria-label={`${label}筛选`}
          className={value !== "all" ? "admin-filter-selected" : undefined}
        >
          {selected ?? label}
          <ChevronDown size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="admin-surface admin-dropdown" align="end">
        {[["all", `全部${label}`], ...options].map(([key, text]) => (
          <DropdownMenuItem key={key} onSelect={() => onChange(key)}>
            <span>{text}</span>
            {key === value && <Check size={14} />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ModelConfigRow({
  item,
  assigned,
}: {
  item: ModelConfig;
  assigned: boolean;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) =>
      enabled ? enableModelConfig(item.id) : disableModelConfig(item.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: modelAdminQueryKey });
      await queryClient.invalidateQueries({
        queryKey: modelAssignmentQueryKey,
      });
    },
  });

  const catalog = useQuery({
    queryKey: ["admin", "model-catalog"],
    queryFn: ({ signal }) => listModelCatalog(signal),
  });
  const metadata = catalog.data
    ?.find(
      (entry) => entry.id === item.secret_ref || entry.id === item.provider,
    )
    ?.models.find((model) => model.name === item.model_name);
  const versionLabel = `${item.model_name} 版本 ${item.config_version}`;
  return (
    <TableRow>
      <TableCell className="text-ink">
        <div className="admin-model-name">
          <span className="admin-provider-icon" aria-hidden>
            {item.provider.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{item.model_name}</strong>
            <small>{item.provider}</small>
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="admin-detail-tags">
          <CapabilityTag value={item.capability} />
          {metadata && <ModelOperationTags model={metadata} />}
        </div>
      </TableCell>
      <TableCell className="text-muted">{item.config_version}</TableCell>
      <TableCell className="text-muted">{item.secret_ref}</TableCell>
      <TableCell>
        <span
          className={`admin-status ${item.enabled ? "is-active" : "is-inactive"}`}
        >
          <span />
          {item.enabled ? "已启用" : "已停用"}
        </span>
        {assigned && <span className="admin-assigned">当前业务模型</span>}
      </TableCell>
      <TableCell className="text-right">
        <Link
          className="admin-model-details-link"
          to={modelDetailsUrl(item.secret_ref, item.model_name, item.id)}
        >
          模型详情
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="admin-icon-button"
              aria-label={`${versionLabel} 操作`}
              title="模型操作"
            >
              <MoreHorizontal size={18} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="admin-surface admin-dropdown"
          >
            <DropdownMenuItem
              disabled={setEnabled.isPending}
              className={item.enabled ? "text-danger" : undefined}
              onSelect={() => {
                setError(null);
                setEnabling(!item.enabled);
                setOpen(true);
              }}
            >
              <Power size={14} />
              {item.enabled ? `停用 ${versionLabel}` : `恢复 ${versionLabel}`}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {error ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {error}
          </p>
        ) : null}
        <AlertDialog onOpenChange={setOpen} open={open}>
          <AlertDialogContent className="admin-surface admin-confirm-dialog">
            <AlertDialogTitle className="admin-dialog-title">
              {enabling ? "恢复这个模型？" : "停用这个模型？"}
            </AlertDialogTitle>
            <AlertDialogDescription className="admin-dialog-description">
              {enabling
                ? "恢复后可以再次指定给业务。停用时取消的业务指定不会自动恢复。已发布的名称、版本和参数保持不变。"
                : "停用后，项目不再使用这个版本。如果它是当前业务模型，指定会同时取消。已发布的名称、版本和参数不会改变，之后可以再恢复。"}
            </AlertDialogDescription>
            <div className="mt-6 flex justify-end gap-3">
              <AlertDialogCancel>取消</AlertDialogCancel>
              {enabling ? (
                <Button
                  disabled={setEnabled.isPending}
                  onClick={() => {
                    void setEnabled
                      .mutateAsync(true)
                      .then(() => setOpen(false))
                      .catch((enableError: unknown) => {
                        setError(userFacingMessage(enableError));
                      });
                  }}
                >
                  确认恢复
                </Button>
              ) : (
                <AlertDialogAction
                  disabled={setEnabled.isPending}
                  onClick={() => {
                    void setEnabled
                      .mutateAsync(false)
                      .catch((disableError: unknown) => {
                        setError(userFacingMessage(disableError));
                      });
                  }}
                >
                  确认停用
                </AlertDialogAction>
              )}
            </div>
          </AlertDialogContent>
        </AlertDialog>
      </TableCell>
    </TableRow>
  );
}

function CapabilityTag({ value }: { value: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-full border border-line px-2 text-xs text-muted">
      {capabilityLabel(value)}
    </span>
  );
}

function capabilityLabel(value: string) {
  if (value === "image_inpaint") return "图像编辑";
  return CAPABILITIES.find(([item]) => item === value)?.[1] ?? value;
}

function BusinessAssignments({
  items,
  assignments,
  pending,
  error,
}: {
  items: ModelConfig[];
  assignments: ModelAssignment[] | undefined;
  pending: boolean;
  error: unknown;
}) {
  const [toast, setToast] = useState<{ ok: boolean; message: string } | null>(
    null,
  );
  const toastTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
      }
    },
    [],
  );

  function showToast(next: { ok: boolean; message: string }) {
    setToast(next);
    if (toastTimer.current !== null) {
      window.clearTimeout(toastTimer.current);
    }
    toastTimer.current = window.setTimeout(
      () => setToast(null),
      ASSIGNMENT_TOAST_MS,
    );
  }

  return (
    <section id="admin-assignments">
      <div className="admin-page-heading">
        <div>
          <h1>业务指定</h1>
          <p>为每项业务指定可用的模型配置。</p>
        </div>
      </div>
      <div className="admin-assignment-list">
        <div className="border-b border-line px-5 py-4">
          <p className="text-xs leading-5 text-muted">
            图片生成与局部重绘共用图片模型，文生视频与图生视频共用视频模型，所有入口自动使用统一配置。模型需支持相应操作；语音和向量暂未接入调用。
          </p>
        </div>
        {pending ? (
          <div role="status" aria-label="正在读取业务模型">
            {Array.from({ length: 5 }, (_, index) => (
              <div className="admin-skeleton admin-skeleton-row" key={index} />
            ))}
          </div>
        ) : null}
        {error ? (
          <p className="px-5 py-4 text-sm text-danger" role="alert">
            {userFacingMessage(error)}
          </p>
        ) : null}
        {assignments
          ? CAPABILITIES.map(([capability, label]) => (
              <AssignmentRow
                assignment={assignments.find(
                  (item) => item.capability === capability,
                )}
                capability={capability}
                items={items}
                key={capability}
                label={label}
                onResult={showToast}
              />
            ))
          : null}
      </div>
      {toast ? (
        <p
          className={`admin-toast ${toast.ok ? "is-ok" : "is-danger"}`}
          role={toast.ok ? "status" : "alert"}
        >
          {toast.ok ? (
            <Check aria-hidden size={16} />
          ) : (
            <CircleAlert aria-hidden size={16} />
          )}
          {toast.message}
        </p>
      ) : null}
    </section>
  );
}

function AssignmentRow({
  capability,
  label,
  items,
  assignment,
  onResult,
}: {
  capability: string;
  label: string;
  items: ModelConfig[];
  assignment: ModelAssignment | undefined;
  onResult: (result: { ok: boolean; message: string }) => void;
}) {
  const queryClient = useQueryClient();
  const choices = items.filter(
    (item) => item.enabled && item.capability === capability,
  );
  const assignedId = assignment?.model_config_id ?? "";
  const fallbackId = choices[0]?.id ?? "";
  const [selected, setSelected] = useState(assignedId || fallbackId);
  const current = assignment?.model_name
    ? `${assignment.provider} · ${assignment.model_name}`
    : "当前未指定";

  useEffect(() => {
    setSelected(assignedId || fallbackId);
  }, [assignedId, fallbackId]);

  const assign = useMutation({
    mutationFn: (modelConfigId: string) =>
      assignModel(capability, modelConfigId),
    onSuccess: async (_assignment, modelConfigId) => {
      const chosen = choices.find((item) => item.id === modelConfigId);
      onResult({
        ok: true,
        message: chosen
          ? `已将${label}指定为 ${chosen.provider} · ${chosen.model_name}`
          : `已更新${label}的指定`,
      });
      await queryClient.invalidateQueries({
        queryKey: modelAssignmentQueryKey,
      });
    },
  });
  const clear = useMutation({
    mutationFn: () => clearModelAssignment(capability),
    onSuccess: async () => {
      onResult({ ok: true, message: `已取消${label}的指定` });
      await queryClient.invalidateQueries({
        queryKey: modelAssignmentQueryKey,
      });
    },
  });

  return (
    <div className="grid gap-3 border-b border-line px-5 py-4 last:border-b-0 md:grid-cols-[160px_minmax(220px,1fr)_auto] md:items-center">
      <div>
        <label
          className="text-sm text-ink"
          htmlFor={`assignment-${capability}`}
        >
          {label}
        </label>
        <p className="mt-1 text-xs text-muted">{current}</p>
      </div>
      <div className="contents">
        <Select
          disabled={choices.length === 0}
          id={`assignment-${capability}`}
          onChange={setSelected}
          options={choices.map((item) => ({
            value: item.id,
            label: `${item.provider} · ${item.model_name}`,
          }))}
          placeholder={
            choices.length === 0 ? "这一类还没有可用模型" : "选择模型"
          }
          value={selected}
        />
        <div className="flex shrink-0 gap-2">
          <Button
            disabled={!selected || assign.isPending}
            onClick={() => {
              void assign
                .mutateAsync(selected)
                .catch((assignError: unknown) => {
                  onResult({
                    ok: false,
                    message: `指定失败：${userFacingMessage(assignError)}`,
                  });
                });
            }}
            type="button"
          >
            设为当前模型
          </Button>
          {assignment?.model_config_id ? (
            <Button
              disabled={clear.isPending}
              onClick={() => {
                void clear.mutateAsync().catch((clearError: unknown) => {
                  onResult({
                    ok: false,
                    message: `取消指定失败：${userFacingMessage(clearError)}`,
                  });
                });
              }}
              type="button"
              variant="outline"
            >
              取消指定
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
