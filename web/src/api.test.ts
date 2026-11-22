import { afterEach, describe, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function fresh() {
  vi.resetModules();
  return import("./api");
}
const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("api()", () => {
  test("GET without a body, POST JSON with a body", async () => {
    const fetchMock = respond(200, { ok: true });
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await fresh();
    await api("/api/x");
    await api("/api/y", { a: 1 });
    expect((fetchMock.mock.calls[0] as any)[1].method).toBe("GET");
    const post = (fetchMock.mock.calls[1] as any)[1];
    expect(post.method).toBe("POST");
    expect(post.headers["Content-Type"]).toBe("application/json");
    expect(post.body).toBe('{"a":1}');
  });

  test("FormData is sent as-is (no JSON content type)", async () => {
    const fetchMock = respond(200, {});
    vi.stubGlobal("fetch", fetchMock);
    const { api } = await fresh();
    const fd = new FormData();
    await api("/api/stt", fd);
    const init = (fetchMock.mock.calls[0] as any)[1];
    expect(init.body).toBe(fd);
    expect(init.headers).toBeUndefined();
  });

  test("server errors surface the server's message and status", async () => {
    vi.stubGlobal("fetch", respond(502, { error: "Claude API error" }));
    const { api, ApiError } = await fresh();
    await expect(api("/api/x")).rejects.toMatchObject({ message: "Claude API error", status: 502 });
    await expect(api("/api/x")).rejects.toBeInstanceOf(ApiError);
  });

  test("non-JSON error bodies get a generic message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>", { status: 500 })));
    const { api } = await fresh();
    await expect(api("/api/x")).rejects.toThrow("Request failed (500)");
  });

  test("network failure → offline error with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const { api } = await fresh();
    await expect(api("/api/x")).rejects.toMatchObject({ status: 0 });
  });

  test("401 notifies listeners (so the app shows the login screen)", async () => {
    vi.stubGlobal("fetch", respond(401, { error: "unauthorized" }));
    const { api, onUnauthorized } = await fresh();
    const spy = vi.fn();
    const off = onUnauthorized(spy);
    await api("/api/x").catch(() => {});
    off();
    await api("/api/x").catch(() => {});
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("serverConfig", () => {
  test("caches the config and falls back to the saved copy when offline", async () => {
    vi.stubGlobal("fetch", respond(200, { authed: true, sttServer: true }));
    let m = await fresh();
    expect((await m.serverConfig())!.sttServer).toBe(true);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    m = await fresh();
    expect((await m.serverConfig(true))!.sttServer).toBe(true);
    expect(m.lastServerConfig()!.authed).toBe(true);
  });

  test("a corrupt saved copy doesn't crash", async () => {
    localStorage.setItem("parla.config", "{broken");
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    const m = await fresh();
    expect(await m.serverConfig(true)).toBeNull();
    expect(m.lastServerConfig()).toBeNull();
  });
});
