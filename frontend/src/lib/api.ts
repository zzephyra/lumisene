import { isRecord } from "./record";

const REQUEST_TIMEOUT_MS = 30_000;
// Compatibility: preserve the existing cookie name so signed-in sessions keep working.
const CSRF_COOKIE_NAME = "fluxora_csrf";

export type ApiErrorInit = {
  status: number;
  code: string;
  message: string;
  details: Record<string, unknown>;
  requestId: string | null;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;
  readonly requestId: string | null;

  constructor(init: ApiErrorInit) {
    super(init.message);
    this.name = "ApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function userFacingMessage(error: unknown): string {
  if (!isApiError(error)) {
    return "无法连接服务器，请重试";
  }
  if (error.status >= 500 && error.code === "invalid_response") {
    return "服务器暂时不可用，请稍后重试";
  }
  if (error.code === "authentication_error") {
    return "邮箱或密码不正确";
  }
  if (error.code === "csrf_failed") {
    return "安全校验失败，请重试";
  }
  if (error.code === "validation_error" || error.code === "domain_error") {
    return "请检查输入内容";
  }
  if (error.code === "network_error" || error.code === "timeout") {
    return "无法连接服务器，请重试";
  }
  if (error.code === "skill_disabled") {
    return "扩图技能已停用，请管理员在技能管理中激活后重试";
  }
  if (error.code === "skill_not_found") {
    return "当前技能版本尚不可用，请联系管理员";
  }
  if (error.code === "skill_validation_error") {
    return "技能输入或模型配置不匹配，请检查扩图范围与模型设置";
  }
  if (error.code === "skill_execution_error") {
    return "技能执行失败，请查看生成任务记录后重试";
  }
  if (error.code === "storage_unavailable") {
    return "上传服务暂不可用";
  }
  return "操作没有完成，请重试";
}

type UnauthorizedHandler = () => void;

let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  unauthorizedHandler = handler;
}

export type ApiRequest = {
  path: string;
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  csrf?: boolean;
  unauthorized?: "throw" | "redirect";
  headers?: Record<string, string>;
};

export function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(";")) {
    const item = part.trim();
    if (item.startsWith(prefix)) {
      return decodeURIComponent(item.slice(prefix.length));
    }
  }
  return null;
}

function parseJson(text: string): unknown {
  return JSON.parse(text);
}

function csrfFailure(): ApiError {
  return new ApiError({
    status: 403,
    code: "csrf_failed",
    message: "安全校验失败，请重试",
    details: {},
    requestId: null,
  });
}

function parseError(status: number, payload: unknown, headerRequestId: string | null): ApiError {
  if (!isRecord(payload) || !isRecord(payload.error)) {
    return new ApiError({
      status,
      code: "invalid_response",
      message: "响应无法识别",
      details: {},
      requestId: headerRequestId,
    });
  }
  const error = payload.error;
  const code = typeof error.code === "string" ? error.code : "invalid_response";
  const message = typeof error.message === "string" ? error.message : "响应无法识别";
  const details = isRecord(error.details) ? error.details : {};
  const requestId = typeof payload.request_id === "string" ? payload.request_id : headerRequestId;
  return new ApiError({ status, code, message, details, requestId });
}

async function readPayload(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === "") {
    return null;
  }
  try {
    return parseJson(text);
  } catch {
    return null;
  }
}

async function perform(request: ApiRequest, allowCsrfFetch: boolean): Promise<unknown> {
  const id = crypto.randomUUID();
  const headers = new Headers({
    Accept: "application/json",
    "X-Request-ID": id,
  });
  if (request.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (request.headers) {
    for (const [name, value] of Object.entries(request.headers)) {
      headers.set(name, value);
    }
  }
  if (request.csrf) {
    let token = readCookie(CSRF_COOKIE_NAME);
    if (!token) {
      if (!allowCsrfFetch) {
        throw csrfFailure();
      }
      await perform(
        { path: "/api/v1/auth/csrf", signal: request.signal, unauthorized: "throw" },
        false,
      );
      token = readCookie(CSRF_COOKIE_NAME);
      if (!token) {
        throw csrfFailure();
      }
    }
    headers.set("X-CSRF-Token", token);
  }

  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeoutSignal]) : timeoutSignal;
  let response: Response;
  try {
    response = await fetch(request.path, {
      method: request.method ?? "GET",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      credentials: "include",
      signal,
    });
  } catch (error) {
    if (request.signal?.aborted) {
      throw error;
    }
    if (isAbortError(error) || timeoutSignal.aborted) {
      throw new ApiError({
        status: 0,
        code: "timeout",
        message: "无法连接服务器，请重试",
        details: {},
        requestId: id,
      });
    }
    throw new ApiError({
      status: 0,
      code: "network_error",
      message: "无法连接服务器，请重试",
      details: {},
      requestId: id,
    });
  }

  const headerRequestId = response.headers.get("x-request-id");
  const payload = await readPayload(response);
  if (response.status === 401) {
    const error = parseError(response.status, payload, headerRequestId);
    if (request.unauthorized !== "throw") {
      unauthorizedHandler?.();
    }
    throw error;
  }
  if (!response.ok) {
    throw parseError(response.status, payload, headerRequestId);
  }
  return payload;
}

export function apiRequest(request: ApiRequest): Promise<unknown> {
  return perform(request, true);
}
