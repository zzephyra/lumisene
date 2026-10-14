import { afterEach, expect, it, vi } from "vitest";
import { setPublication } from "./works-api";

afterEach(() => {
  vi.unstubAllGlobals();
  document.cookie = "fluxora_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
});
it.each([true, false])("sends CSRF for publication=%s through the real request client", async value => {
  document.cookie = "fluxora_csrf=publication-test; path=/";
  const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    expect(new Headers(init?.headers).get("X-CSRF-Token")).toBe("publication-test");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ public: value });
    return new Response(JSON.stringify({ id: "a", public: value, can_publish: true }), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  expect(await setPublication("p", "a", value)).toEqual({ id: "a", public: value, can_publish: true });
  expect(fetchMock).toHaveBeenCalledOnce();
});
