import { apiRequest, ApiError } from "../../lib/api";
import { isRecord } from "../../lib/record";

export const modelAdminQueryKey = ["admin", "model-configs"] as const;
export const modelAssignmentQueryKey = ["admin", "model-assignments"] as const;

export type ModelAssignment = {
  capability: string;
  model_config_id: string | null;
  provider: string | null;
  model_name: string | null;
  config_version: number | null;
};

export type ModelConfig = {
  id: string;
  provider: string;
  model_name: string;
  capability: string;
  config_version: number;
  parameters_schema: Record<string, unknown>;
  limits: Record<string, unknown>;
  secret_ref: string;
  enabled: boolean;
};

export type CreateModelConfigInput = {
  provider: string;
  model_name: string;
  capability: string;
  parameters_schema: Record<string, unknown>;
  limits: Record<string, unknown>;
  secret_ref: string;
};

export type ProviderModelOption = {
  name: string;
  alias_zh: string;
  alias_en: string;
  capabilities: string[];
  inputs: string[];
  parameters: Record<string, Array<string | number>>;
};

export type ProviderCatalogItem = {
  id: string;
  alias_zh: string;
  alias_en: string;
  models: ProviderModelOption[];
};

function invalidResponse(): ApiError {
  return new ApiError({
    status: 500,
    code: "invalid_response",
    message: "响应无法识别",
    details: {},
    requestId: null,
  });
}

function parseConfig(value: unknown): ModelConfig | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.id !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.model_name !== "string" ||
    typeof value.capability !== "string" ||
    typeof value.config_version !== "number" ||
    typeof value.secret_ref !== "string" ||
    typeof value.enabled !== "boolean" ||
    !isRecord(value.parameters_schema) ||
    !isRecord(value.limits)
  ) {
    return null;
  }
  return {
    id: value.id,
    provider: value.provider,
    model_name: value.model_name,
    capability: value.capability,
    config_version: value.config_version,
    parameters_schema: value.parameters_schema,
    limits: value.limits,
    secret_ref: value.secret_ref,
    enabled: value.enabled,
  };
}

export async function listModelConfigs(signal?: AbortSignal): Promise<ModelConfig[]> {
  const body = await apiRequest({ path: "/api/v1/admin/model-configs", signal });
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw invalidResponse();
  }
  const items = body.items.map(parseConfig);
  if (items.some((item) => item === null)) {
    throw invalidResponse();
  }
  return items as ModelConfig[];
}

function parseChoices(value: unknown): Array<string | number> | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const choices: Array<string | number> = [];
  for (const item of value) {
    if (typeof item === "string" || typeof item === "number") {
      choices.push(item);
      continue;
    }
    return null;
  }
  return choices;
}

function parseProviderModel(value: unknown): ProviderModelOption | null {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.alias_zh !== "string" ||
    typeof value.alias_en !== "string" ||
    !Array.isArray(value.capabilities) ||
    !value.capabilities.every((item) => typeof item === "string") ||
    !Array.isArray(value.inputs) ||
    !value.inputs.every((item) => typeof item === "string") ||
    !isRecord(value.parameters)
  ) {
    return null;
  }
  const parameters: Record<string, Array<string | number>> = {};
  for (const [key, item] of Object.entries(value.parameters)) {
    const choices = parseChoices(item);
    if (!choices) {
      return null;
    }
    parameters[key] = choices;
  }
  return {
    name: value.name,
    alias_zh: value.alias_zh,
    alias_en: value.alias_en,
    capabilities: value.capabilities,
    inputs: value.inputs,
    parameters,
  };
}

function parseProvider(value: unknown): ProviderCatalogItem | null {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.alias_zh !== "string" ||
    typeof value.alias_en !== "string" ||
    !Array.isArray(value.models)
  ) {
    return null;
  }
  const models = value.models.map(parseProviderModel);
  if (models.some((item) => item === null)) {
    return null;
  }
  return {
    id: value.id,
    alias_zh: value.alias_zh,
    alias_en: value.alias_en,
    models: models as ProviderModelOption[],
  };
}

export async function listModelCatalog(signal?: AbortSignal): Promise<ProviderCatalogItem[]> {
  const body = await apiRequest({ path: "/api/v1/admin/model-catalog", signal });
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw invalidResponse();
  }
  const items = body.items.map(parseProvider);
  if (items.some((item) => item === null)) {
    throw invalidResponse();
  }
  return items as ProviderCatalogItem[];
}

export async function createModelConfig(input: CreateModelConfigInput): Promise<ModelConfig> {
  const body = await apiRequest({
    path: "/api/v1/admin/model-configs",
    method: "POST",
    body: input,
    csrf: true,
  });
  const config = parseConfig(body);
  if (!config) {
    throw invalidResponse();
  }
  return config;
}

function parseAssignment(value: unknown): ModelAssignment | null {
  if (!isRecord(value) || typeof value.capability !== "string") {
    return null;
  }
  return {
    capability: value.capability,
    model_config_id: typeof value.model_config_id === "string" ? value.model_config_id : null,
    provider: typeof value.provider === "string" ? value.provider : null,
    model_name: typeof value.model_name === "string" ? value.model_name : null,
    config_version: typeof value.config_version === "number" ? value.config_version : null,
  };
}

export async function listModelAssignments(signal?: AbortSignal): Promise<ModelAssignment[]> {
  const body = await apiRequest({ path: "/api/v1/admin/model-assignments", signal });
  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw invalidResponse();
  }
  const items = body.items.map(parseAssignment);
  if (items.some((item) => item === null)) {
    throw invalidResponse();
  }
  return items as ModelAssignment[];
}

export async function assignModel(capability: string, modelConfigId: string): Promise<ModelAssignment> {
  const body = await apiRequest({
    path: `/api/v1/admin/model-assignments/${capability}`,
    method: "PUT",
    body: { model_config_id: modelConfigId },
    csrf: true,
  });
  const assignment = parseAssignment(body);
  if (!assignment) {
    throw invalidResponse();
  }
  return assignment;
}

export async function clearModelAssignment(capability: string): Promise<void> {
  await apiRequest({
    path: `/api/v1/admin/model-assignments/${capability}`,
    method: "DELETE",
    csrf: true,
  });
}

export async function disableModelConfig(configId: string): Promise<ModelConfig> {
  return setModelConfigEnabled(configId, false);
}

export async function enableModelConfig(configId: string): Promise<ModelConfig> {
  return setModelConfigEnabled(configId, true);
}

async function setModelConfigEnabled(configId: string, enabled: boolean): Promise<ModelConfig> {
  const body = await apiRequest({
    path: `/api/v1/admin/model-configs/${configId}`,
    method: "PATCH",
    body: { enabled },
    csrf: true,
  });
  const config = parseConfig(body);
  if (!config) {
    throw invalidResponse();
  }
  return config;
}
