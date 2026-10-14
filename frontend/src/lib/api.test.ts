import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, userFacingMessage, apiRequest, setUnauthorizedHandler } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  setUnauthorizedHandler(null);
  document.cookie = "fluxora_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});

describe("apiRequest", () => {
  it("sends the csrf cookie and request id", async () => {
    document.cookie = "fluxora_csrf=token-1";
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await apiRequest({
      path: "/api/v1/projects",
      method: "POST",
      body: { name: "春季成片" },
      csrf: true,
    });

    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("include");
    expect(init?.headers).toBeInstanceOf(Headers);
    if (!(init?.headers instanceof Headers)) {
      throw new Error("fetch was not called with headers");
    }
    expect(init.headers.get("X-CSRF-Token")).toBe("token-1");
    expect(init.headers.get("X-Request-ID")).toBeTruthy();
  });

  it("clears the session handler on 401 and keeps login failures local", async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    const body = JSON.stringify({
      error: { code: "authentication_error", message: "Authentication failed", details: {} },
      request_id: "req-9",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(body, {
            status: 401,
            headers: { "Content-Type": "application/json" },
          }),
      ),
    );

    await expect(apiRequest({ path: "/api/v1/projects" })).rejects.toMatchObject({
      status: 401,
      code: "authentication_error",
      requestId: "req-9",
    });
    expect(handler).toHaveBeenCalledOnce();

    await expect(
      apiRequest({ path: "/api/v1/auth/login", method: "POST", unauthorized: "throw" }),
    ).rejects.toMatchObject({ status: 401 });
    expect(handler).toHaveBeenCalledOnce();
  });
});

it("explains gateway failures without exposing server internals", () => {
  for (const status of [500, 502, 503, 504]) {
    expect(userFacingMessage(new ApiError({ status, code: "invalid_response", message: "proxy internals", details: {}, requestId: null }))).toBe("服务器暂时不可用，请稍后重试");
  }
});
