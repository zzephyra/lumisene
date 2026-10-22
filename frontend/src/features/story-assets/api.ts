import { ApiError, apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";

export type LibraryCategory = "all" | "character" | "scene" | "shot" | "video" | "document";
export type LibrarySort = "newest" | "oldest" | "name";
export type LibraryKind = "image" | "video" | "document";
export type LibrarySource = "upload" | "generated";
export type LinkCategory = "general" | "scene" | "shot";

export type LibraryReference = {
  type: "story" | "character" | "scene";
  id: string;
  name: string;
  primary: boolean;
};

export type LibraryAsset = {
  id: string;
  source: LibrarySource;
  asset_id: string | null;
  upload_id: string | null;
  name: string;
  filename: string;
  kind: LibraryKind;
  mime: string;
  size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: string;
  references: LibraryReference[];
  direct_link_id: string | null;
  category: string;
  preview_url: string;
  thumbnail_url: string | null;
  can_delete: boolean;
};

export type LibraryPage = {
  items: LibraryAsset[];
  total: number;
  next_offset: number | null;
};

export type LibraryOptions = {
  limits: { image: number; video: number; file: number };
  formats: { image: string[]; video: string[]; document: string[] };
};

export type LibraryQuery = {
  category?: LibraryCategory;
  search?: string;
  sort?: LibrarySort;
  offset?: number;
  limit?: number;
};

function invalid(): never {
  throw new ApiError({
    status: 500,
    code: "invalid_response",
    message: "响应无法识别",
    details: {},
    requestId: null,
  });
}

function text(value: unknown, name: string): string {
  if (!isRecord(value) || typeof value[name] !== "string") invalid();
  return value[name];
}

function reference(value: unknown): LibraryReference {
  if (
    !isRecord(value) ||
    (value.type !== "story" && value.type !== "character" && value.type !== "scene") ||
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    typeof value.primary !== "boolean"
  ) {
    invalid();
  }
  return { type: value.type, id: value.id, name: value.name, primary: value.primary };
}

function asset(value: unknown): LibraryAsset {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    (value.source !== "upload" && value.source !== "generated") ||
    typeof value.name !== "string" ||
    typeof value.filename !== "string" ||
    (value.kind !== "image" && value.kind !== "video" && value.kind !== "document") ||
    typeof value.mime !== "string" ||
    typeof value.size !== "number" ||
    typeof value.created_at !== "string" ||
    !Array.isArray(value.references) ||
    typeof value.category !== "string" ||
    typeof value.preview_url !== "string" ||
    typeof value.can_delete !== "boolean"
  ) {
    invalid();
  }
  return {
    id: value.id,
    source: value.source,
    asset_id: typeof value.asset_id === "string" ? value.asset_id : null,
    upload_id: typeof value.upload_id === "string" ? value.upload_id : null,
    name: value.name,
    filename: value.filename,
    kind: value.kind,
    mime: value.mime,
    size: value.size,
    width: typeof value.width === "number" ? value.width : null,
    height: typeof value.height === "number" ? value.height : null,
    duration_ms: typeof value.duration_ms === "number" ? value.duration_ms : null,
    created_at: value.created_at,
    references: value.references.map(reference),
    direct_link_id: typeof value.direct_link_id === "string" ? value.direct_link_id : null,
    category: value.category,
    preview_url: value.preview_url,
    thumbnail_url: typeof value.thumbnail_url === "string" ? value.thumbnail_url : null,
    can_delete: value.can_delete,
  };
}

function root(projectId: string, storyId: string) {
  return `/api/v1/projects/${projectId}/stories/${storyId}/resources`;
}

export async function libraryOptions(
  projectId: string,
  storyId: string,
  signal?: AbortSignal,
): Promise<LibraryOptions> {
  const value = await apiRequest({ path: `${root(projectId, storyId)}/options`, signal });
  if (
    !isRecord(value) ||
    !isRecord(value.limits) ||
    typeof value.limits.image !== "number" ||
    typeof value.limits.video !== "number" ||
    typeof value.limits.file !== "number" ||
    !isRecord(value.formats)
  ) {
    invalid();
  }
  return {
    limits: {
      image: value.limits.image,
      video: value.limits.video,
      file: value.limits.file,
    },
    formats: {
      image: stringList(value.formats.image),
      video: stringList(value.formats.video),
      document: stringList(value.formats.document),
    },
  };
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) invalid();
  return value;
}

export async function listResources(
  projectId: string,
  storyId: string,
  query: LibraryQuery,
  signal?: AbortSignal,
): Promise<LibraryPage> {
  const params = new URLSearchParams();
  params.set("category", query.category ?? "all");
  if (query.search) params.set("search", query.search);
  params.set("sort", query.sort ?? "newest");
  params.set("offset", String(query.offset ?? 0));
  params.set("limit", String(query.limit ?? 24));
  const value = await apiRequest({
    path: `${root(projectId, storyId)}?${params.toString()}`,
    signal,
  });
  if (!isRecord(value) || !Array.isArray(value.items) || typeof value.total !== "number") {
    invalid();
  }
  return {
    items: value.items.map(asset),
    total: value.total,
    next_offset: typeof value.next_offset === "number" ? value.next_offset : null,
  };
}

export async function attachResource(
  projectId: string,
  storyId: string,
  body: { upload_id: string; name: string; category: LinkCategory },
): Promise<LibraryAsset> {
  return asset(
    await apiRequest({
      path: root(projectId, storyId),
      method: "POST",
      csrf: true,
      body,
    }),
  );
}

export async function renameResource(
  projectId: string,
  storyId: string,
  item: Pick<LibraryAsset, "source" | "id">,
  name: string,
): Promise<LibraryAsset> {
  return asset(
    await apiRequest({
      path: `${root(projectId, storyId)}/${item.source}/${item.id}`,
      method: "PATCH",
      csrf: true,
      body: { name },
    }),
  );
}

export async function removeResource(
  projectId: string,
  storyId: string,
  item: Pick<LibraryAsset, "source" | "id">,
  original: boolean,
): Promise<void> {
  const value = await apiRequest({
    path: `${root(projectId, storyId)}/${item.source}/${item.id}?original=${original ? "true" : "false"}`,
    method: "DELETE",
    csrf: true,
  });
  if (!isRecord(value) || value.removed !== true) invalid();
}

export async function resourceText(
  projectId: string,
  storyId: string,
  item: Pick<LibraryAsset, "source" | "id">,
  signal?: AbortSignal,
): Promise<string> {
  const value = await apiRequest({
    path: `${root(projectId, storyId)}/${item.source}/${item.id}/text`,
    signal,
  });
  return text(value, "text");
}
