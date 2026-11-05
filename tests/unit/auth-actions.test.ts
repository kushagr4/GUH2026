import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = {
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({ auth: authMock })),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers({ origin: "http://localhost:3000" })),
}));

// redirect() really works by throwing, and so does this stand-in.
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});
vi.mock("next/navigation", () => ({ redirect }));

const { signIn, signOut, signUp } = await import("@/features/auth/actions");
const { friendlyAuthError } = await import("@/features/auth/errors");

const IDLE = { status: "idle" } as const;

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("auth actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abc.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_abc");
  });

  describe("signIn", () => {
    it("redirects to the safe target on success", async () => {
      authMock.signInWithPassword.mockResolvedValue({ error: null });
      await expect(
        signIn(IDLE, form({ email: "a@b.co", password: "pw", next: "/app/items" })),
      ).rejects.toThrow("REDIRECT:/app/items");
    });

    it("ignores an open-redirect attempt", async () => {
      authMock.signInWithPassword.mockResolvedValue({ error: null });
      await expect(
        signIn(IDLE, form({ email: "a@b.co", password: "pw", next: "//evil.test" })),
      ).rejects.toThrow("REDIRECT:/app/dashboard");
    });

    it("shows a friendly error for bad credentials", async () => {
      authMock.signInWithPassword.mockResolvedValue({
        error: { code: "invalid_credentials", message: "raw" },
      });
      await expect(
        signIn(IDLE, form({ email: "a@b.co", password: "wrong" })),
      ).resolves.toEqual({
        status: "error",
        message: "Incorrect email or password.",
      });
    });

    it("validates before calling Supabase", async () => {
      const result = await signIn(IDLE, form({ email: "nope", password: "pw" }));
      expect(result.status).toBe("error");
      expect(authMock.signInWithPassword).not.toHaveBeenCalled();
    });

    it("explains itself when Supabase is not configured", async () => {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
      const result = await signIn(IDLE, form({ email: "a@b.co", password: "pw" }));
      expect(result).toMatchObject({ status: "error" });
      expect(authMock.signInWithPassword).not.toHaveBeenCalled();
    });
  });

  describe("signUp", () => {
    const valid = { email: "a@b.co", password: "long-enough-password" };

    it("rejects short passwords before calling Supabase", async () => {
      const result = await signUp(IDLE, form({ email: "a@b.co", password: "short" }));
      expect(result.status).toBe("error");
      expect(authMock.signUp).not.toHaveBeenCalled();
    });

    it("signs the user straight in when confirmation is off", async () => {
      authMock.signUp.mockResolvedValue({
        data: { session: { access_token: "t" } },
        error: null,
      });
      await expect(signUp(IDLE, form(valid))).rejects.toThrow(
        "REDIRECT:/app/dashboard",
      );
    });

    it("asks the user to check their email when confirmation is on", async () => {
      authMock.signUp.mockResolvedValue({ data: { session: null }, error: null });
      await expect(signUp(IDLE, form(valid))).resolves.toMatchObject({
        status: "check-email",
      });
    });

    it("sends the confirmation link back to this app's origin", async () => {
      authMock.signUp.mockResolvedValue({ data: { session: null }, error: null });
      await signUp(IDLE, form(valid));
      expect(authMock.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
        "http://localhost:3000/auth/callback",
      );
    });
  });

  describe("signOut", () => {
    it("ends the session and returns to the login page", async () => {
      authMock.signOut.mockResolvedValue({ error: null });
      await expect(signOut()).rejects.toThrow("REDIRECT:/login");
      expect(authMock.signOut).toHaveBeenCalledOnce();
    });
  });
});

describe("friendlyAuthError", () => {
  it.each([
    "over_email_send_rate_limit",
    "email_address_not_authorized",
    "over_request_rate_limit",
  ])("explains the free-plan limit %s", (code) => {
    const message = friendlyAuthError({ code, message: "raw" });
    expect(message).not.toBe("raw");
    expect(message.length).toBeGreaterThan(20);
  });

  it("recognises the older not-authorized message", () => {
    expect(
      friendlyAuthError({ message: "Email address not authorized" }),
    ).toContain("organisation members");
  });

  it("does not repeat unknown raw errors to the user", () => {
    expect(friendlyAuthError({ code: "x", message: "internal detail" })).not.toContain(
      "internal detail",
    );
  });
});
