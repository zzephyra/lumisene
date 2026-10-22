import { ApiError, apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";

export type Story = {
  id: string;
  project_id: string;
  title: string;
  description: string | null;
  cover_upload_id: string | null;
  cover_url: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

export type StoryInput = {
  title: string;
  description?: string | null;
  cover_upload_id?: string | null;
};

export type StoryPage = {
  items: Story[];
  next_cursor: string | null;
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

function story(value: unknown): Story {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.project_id !== "string" ||
    typeof value.title !== "string" ||
    typeof value.version !== "number" ||
    (value.description !== null && typeof value.description !== "string") ||
    (value.cover_upload_id !== null &&
      typeof value.cover_upload_id !== "string") ||
    (value.cover_url !== null && typeof value.cover_url !== "string")
  ) {
    invalid();
  }
  return value as Story;
}

export async function listStories(
  projectId: string,
  cursor: string | null,
  signal?: AbortSignal,
) {
  const query = cursor
    ? `?limit=100&cursor=${encodeURIComponent(cursor)}`
    : "?limit=100";
  const value = await apiRequest({
    path: `/api/v1/projects/${projectId}/stories${query}`,
    signal,
  });
  if (!isRecord(value) || !Array.isArray(value.items)) invalid();
  return {
    items: value.items.map(story),
    next_cursor:
      typeof value.next_cursor === "string" ? value.next_cursor : null,
  } satisfies StoryPage;
}

export async function getStory(
  projectId: string,
  storyId: string,
  signal?: AbortSignal,
) {
  return story(
    await apiRequest({
      path: `/api/v1/projects/${projectId}/stories/${storyId}`,
      signal,
    }),
  );
}

export async function createStory(projectId: string, body: StoryInput) {
  return story(
    await apiRequest({
      path: `/api/v1/projects/${projectId}/stories`,
      method: "POST",
      csrf: true,
      body,
    }),
  );
}

export async function updateStory(
  projectId: string,
  storyId: string,
  body: StoryInput & { expected_version: number },
) {
  return story(
    await apiRequest({
      path: `/api/v1/projects/${projectId}/stories/${storyId}`,
      method: "PATCH",
      csrf: true,
      body,
    }),
  );
}

export async function deleteStory(
  projectId: string,
  storyId: string,
  version: number,
) {
  await apiRequest({
    path: `/api/v1/projects/${projectId}/stories/${storyId}?expected_version=${version}`,
    method: "DELETE",
    csrf: true,
  });
}
