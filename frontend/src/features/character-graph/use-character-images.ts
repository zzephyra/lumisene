import { useEffect, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { components } from "../../api/schema";
import type { Character } from "./api";
import { apiRequest } from "../../lib/api";
import { isRecord } from "../../lib/record";
import { uploadFile } from "../uploads";

type Images = components["schemas"]["CharacterImagesView"];
export type CharacterImage = components["schemas"]["CharacterImageView"];
type Transfer = {
  id: string;
  file: File;
  preview: string;
  uploadId?: string;
  status: "uploading" | "failed" | "succeeded";
  error?: string;
};
function validate(value: unknown): Images {
  if (
    !isRecord(value) ||
    !Array.isArray(value.images) ||
    !Array.isArray(value.jobs)
  )
    throw new Error("图片响应无效");
  for (const image of value.images)
    if (
      !isRecord(image) ||
      typeof image.id !== "string" ||
      typeof image.image_url !== "string" ||
      typeof image.is_primary !== "boolean"
    )
      throw new Error("图片数据无效");
  for (const job of value.jobs)
    if (
      !isRecord(job) ||
      typeof job.id !== "string" ||
      typeof job.status !== "string"
    )
      throw new Error("任务数据无效");
  return value as Images;
}
export function useCharacterImages(
  projectId: string,
  storyId: string,
  characterId: string | null,
) {
  const client = useQueryClient();
  const root = `/api/v1/projects/${projectId}/stories/${storyId}/characters/${characterId}`;
  const scope = ["projects", projectId, "stories", storyId];
  const key = [...scope, "character-images", characterId];
  const identity = `${projectId}:${storyId}:${characterId}`;
  const current = useRef(identity);
  current.current = identity;
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const urls = useRef<string[]>([]);
  const query = useQuery({
    queryKey: key,
    enabled: !!characterId,
    queryFn: async ({ signal }) =>
      validate(await apiRequest({ path: `${root}/images`, signal })),
    refetchInterval: (query) =>
      query.state.data?.jobs.some(
        (j) =>
          ["queued", "running"].includes(j.status) ||
          (j.status === "succeeded" && !j.collected),
      )
        ? 1500
        : false,
  });
  useEffect(() => {
    setTransfers([]);
    setError("");
    setPending(false);
    setDragging(false);
    depth.current = 0;
  }, [identity]);
  useEffect(
    () => () => {
      urls.current.forEach(URL.revokeObjectURL);
    },
    [],
  );
  const revision = query.data?.images
    .map((i) => `${i.id}:${i.is_primary}`)
    .join(",");
  useEffect(() => {
    if (revision !== undefined)
      void client.invalidateQueries({
        queryKey: [...scope, "character-graph"],
      });
  }, [revision, identity]);
  async function refresh() {
    await Promise.all([
      client.invalidateQueries({ queryKey: key }),
      client.invalidateQueries({ queryKey: [...scope, "character-graph"] }),
    ]);
  }
  async function transfer(item: Transfer) {
    const update = (change: Partial<Transfer>) => {
      if (current.current === identity)
        setTransfers((old) =>
          old.map((t) => (t.id === item.id ? { ...t, ...change } : t)),
        );
    };
    update({ status: "uploading", error: undefined });
    try {
      const uploadId =
        item.uploadId ??
        (await uploadFile(item.file, { category: "image" })).id;
      update({ uploadId });
      await apiRequest({
        path: `${root}/images`,
        method: "POST",
        csrf: true,
        body: { upload_id: uploadId },
      });
      update({ status: "succeeded" });
      await refresh();
    } catch (reason) {
      update({
        status: "failed",
        error: reason instanceof Error ? reason.message : "上传失败",
      });
    }
  }
  function upload(files: File[]) {
    if (!characterId) return;
    const items = files.map((file) => {
      const valid =
        ["image/jpeg", "image/png", "image/webp"].includes(file.type) &&
        file.size <= 20 * 1024 * 1024;
      const preview = valid ? URL.createObjectURL(file) : "";
      if (preview) urls.current.push(preview);
      return {
        id: crypto.randomUUID(),
        file,
        preview,
        status: valid ? "uploading" : "failed",
        error: valid ? undefined : "仅支持 20 MB 内 JPG、PNG、WebP",
      } as Transfer;
    });
    setTransfers((old) => [...old, ...items]);
    // Queue files independently; one failed transfer never prevents the next one.
    void (async () => {
      for (const item of items)
        if (item.status === "uploading") await transfer(item);
    })();
  }
  async function mutate(path: string, method: "PUT" | "DELETE") {
    setPending(true);
    setError("");
    try {
      await apiRequest({ path: `${root}/images/${path}`, method, csrf: true });
      await refresh();
    } catch (reason) {
      if (current.current === identity)
        setError(reason instanceof Error ? reason.message : "操作失败");
    } finally {
      if (current.current === identity) setPending(false);
    }
  }
  const generationKey = useRef<string | null>(null);
  useEffect(() => {
    generationKey.current = null;
  }, [identity]);
  async function generate(
    mode: "candidate" | "reference",
    instruction: string,
    character: Character,
  ) {
    if (pending) return;
    setPending(true);
    setError("");
    const requestKey = generationKey.current ?? crypto.randomUUID();
    generationKey.current = requestKey;
    try {
      await apiRequest({
        path: `${root}/image-generations`,
        method: "POST",
        csrf: true,
        headers: { "Idempotency-Key": requestKey },
        body: {
          mode,
          instruction,
          profile: {
            name: character.name,
            title: character.title,
            age: character.age,
            gender: character.gender,
            occupation: character.occupation,
            role_type: character.role_type,
            aliases: character.aliases,
            profile_data: character.profile_data,
          },
        },
      });
      if (current.current === identity) generationKey.current = null;
      await refresh();
      return true;
    } catch (reason) {
      if (current.current === identity)
        setError(reason instanceof Error ? reason.message : "生成失败");
      return false;
    } finally {
      if (current.current === identity) setPending(false);
    }
  }
  const files = (event: DragEvent) =>
    !!characterId &&
    event.currentTarget.contains(event.target as Node) &&
    Array.from(event.dataTransfer.types).includes("Files");
  const dropzone = {
    onDragEnter(event: DragEvent) {
      if (files(event)) {
        event.preventDefault();
        depth.current++;
        setDragging(true);
      }
    },
    onDragOver(event: DragEvent) {
      if (files(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }
    },
    onDragLeave(event: DragEvent) {
      if (files(event)) {
        event.preventDefault();
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setDragging(false);
      }
    },
    onDrop(event: DragEvent) {
      if (files(event)) {
        event.preventDefault();
        event.stopPropagation();
        depth.current = 0;
        setDragging(false);
        upload(Array.from(event.dataTransfer.files));
      }
    },
  };
  return {
    query,
    transfers,
    error,
    pending,
    dragging,
    dropzone,
    upload,
    retry: transfer,
    mutate,
    generate,
    running:
      query.data?.jobs.some(
        (j) =>
          ["queued", "running"].includes(j.status) ||
          (j.status === "succeeded" && !j.collected),
      ) ?? false,
  };
}
export type CharacterImagesController = ReturnType<typeof useCharacterImages>;
