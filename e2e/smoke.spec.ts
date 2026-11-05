import { expect, test } from "@playwright/test";

/** These need no Supabase account, so they run for everyone and in CI. */
test.describe("public pages", () => {
  test("home page renders and links to auth", async ({ page }) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  });

  test("login and sign-up forms render", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();

    await page.goto("/signup");
    await expect(page.getByRole("button", { name: "Create account" })).toBeVisible();
  });

  test("works at phone width with no sideways scrolling", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const path of ["/", "/login", "/signup"]) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, path).toBeLessThanOrEqual(0);
    }
  });

  test("an unknown page returns a real 404", async ({ page }) => {
    const response = await page.goto("/does-not-exist");
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Page not found")).toBeVisible();
  });

  test("the health endpoint reports liveness", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({ ok: true });
  });

  test("responses carry security headers", async ({ request }) => {
    const response = await request.get("/");
    const headers = response.headers();
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-powered-by"]).toBeUndefined();
  });
});

test.describe("access control without a session", () => {
  test("protected pages redirect to login and remember the target", async ({ page }) => {
    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fdashboard/);
  });

  test("the AI endpoint refuses anonymous callers", async ({ request }) => {
    const response = await request.post("/api/ai/chat", {
      data: { messages: [{ role: "user", content: "hello" }] },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("production gate", () => {
  const GATED = "http://127.0.0.1:3101";

  for (const path of ["/dev", "/dev/records", "/dev/storage", "/dev/realtime", "/dev/ai"]) {
    test(`${path} is hidden by default in production`, async ({ request }) => {
      const response = await request.get(`${GATED}${path}`);
      expect(response.status()).toBe(404);
    });
  }

  test("the diagnostics link is hidden by default in production", async ({ page }) => {
    await page.goto(`${GATED}/`);
    await expect(page.getByRole("link", { name: "Diagnostics" })).toHaveCount(0);
  });
});
