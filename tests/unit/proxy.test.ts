import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateSession = vi.fn();
vi.mock("@/lib/supabase/proxy", () => ({ updateSession }));

const { proxy } = await import("@/proxy");

function request(path: string) {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

describe("proxy", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    updateSession.mockResolvedValue({
      response: NextResponse.next(),
      userId: null,
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("redirects signed-out visitors away from /app and remembers the target", async () => {
    const response = await proxy(request("/app/items?tab=2"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/app/items?tab=2");
  });

  it("lets signed-in users through to /app", async () => {
    updateSession.mockResolvedValue({ response: NextResponse.next(), userId: "u1" });
    const response = await proxy(request("/app/dashboard"));
    expect(response.headers.get("location")).toBeNull();
    expect(response.status).toBe(200);
  });

  it("leaves public pages open", async () => {
    const response = await proxy(request("/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("hides /dev in production without touching Supabase", async () => {
    const response = await proxy(request("/dev"));
    expect(response.status).toBe(404);
    expect(updateSession).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.stringContaining("/dev") }),
    );
  });

  it("serves /dev in production with the explicit opt-in", async () => {
    vi.stubEnv("ENABLE_DEV_TOOLS", "true");
    expect((await proxy(request("/dev"))).status).toBe(200);
  });

  it("serves /dev in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect((await proxy(request("/dev"))).status).toBe(200);
  });
});
