import { afterEach, describe, expect, it, vi } from "vitest";
import { isDevToolsEnabled, isPrivilegedKey, readSupabaseEnv } from "@/lib/env";

const URL = "https://abcdefgh.supabase.co";
const KEY = "sb_publishable_abc123";

function fakeJwt(role: string) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "HS256" })}.${encode({ role })}.signature`;
}

describe("readSupabaseEnv", () => {
  it("accepts a real-looking URL and publishable key", () => {
    expect(readSupabaseEnv({ url: URL, key: KEY })).toEqual({
      state: "ok",
      url: URL,
      publishableKey: KEY,
    });
  });

  it("strips trailing slashes from the URL", () => {
    const env = readSupabaseEnv({ url: `${URL}/`, key: KEY });
    expect(env).toMatchObject({ state: "ok", url: URL });
  });

  it.each([
    [undefined, KEY],
    [URL, undefined],
    ["", ""],
    ["   ", KEY],
  ])("reports missing values (%s, %s)", (url, key) => {
    expect(readSupabaseEnv({ url, key }).state).toBe("missing");
  });

  it("recognises the placeholders from .env.example", () => {
    const env = readSupabaseEnv({
      url: "https://your-project-ref.supabase.co",
      key: "your-publishable-key",
    });
    expect(env.state).toBe("placeholder");
  });

  it("rejects a malformed URL", () => {
    expect(readSupabaseEnv({ url: "not a url", key: KEY }).state).toBe("invalid");
    expect(readSupabaseEnv({ url: "ftp://x.test", key: KEY }).state).toBe("invalid");
  });

  it("refuses a secret key in the public variable", () => {
    expect(readSupabaseEnv({ url: URL, key: "sb_secret_abc" }).state).toBe("unsafe");
    expect(readSupabaseEnv({ url: URL, key: fakeJwt("service_role") }).state).toBe(
      "unsafe",
    );
  });
});

describe("isPrivilegedKey", () => {
  it("allows publishable and legacy anon keys", () => {
    expect(isPrivilegedKey(KEY)).toBe(false);
    expect(isPrivilegedKey(fakeJwt("anon"))).toBe(false);
  });

  it("does not throw on a malformed token", () => {
    expect(isPrivilegedKey("eyJnotjson.%%%.x")).toBe(false);
  });
});

describe("isDevToolsEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is on in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isDevToolsEnabled()).toBe(true);
  });

  it("is off in production by default", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isDevToolsEnabled()).toBe(false);
  });

  it("is on in production only with an exact opt-in", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_DEV_TOOLS", "1");
    expect(isDevToolsEnabled()).toBe(false);
    vi.stubEnv("ENABLE_DEV_TOOLS", "true");
    expect(isDevToolsEnabled()).toBe(true);
  });
});
