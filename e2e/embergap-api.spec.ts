import { expect, test, type Page } from "@playwright/test";
import { readTestEnv, SKIP_REASON } from "../tests/support/test-env";
import { cleanupTestUser, createTestUser, type TestUser } from "../tests/support/test-users";

const env = readTestEnv();

/**
 * POST /api/embergap/reports end to end: a real browser session cookie, the
 * Next.js route and the database trigger. The report form UI is d3vmakes'
 * (e2e/embergap-report*.spec.ts); this checks only the API contract.
 */
test.describe("EmberGap report API", () => {
  test.skip(!env, SKIP_REASON);
  test.describe.configure({ mode: "serial" });

  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser(env!);
  });

  test.afterAll(async () => {
    if (user) await cleanupTestUser(env!, user);
  });

  async function signIn(page: Page) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app\//);
  }

  function post(page: Page, body: unknown) {
    return page.evaluate(async (payload) => {
      const response = await fetch("/api/embergap/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return { status: response.status, json: await response.json() };
    }, body);
  }

  test("refuses a request without a session", async ({ request }) => {
    const response = await request.post("/api/embergap/reports", { data: {} });
    expect(response.status()).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  test("creates an unverified report and replays a retry", async ({ page }) => {
    await signIn(page);
    const body = {
      clientRequestId: crypto.randomUUID(),
      observedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
      location: { latitude: 53.4808, longitude: -2.2426, uncertaintyMeters: 500 },
      description: "E2E check: grey smoke over the hills to the east.",
    };

    const first = await post(page, body);
    expect(first.status).toBe(201);
    expect(first.json).toMatchObject({ investigationStatus: "unreviewed", verification: "unverified", replayed: false, mediaId: null });
    expect(first.json.reportId).toMatch(/^[0-9a-f-]{36}$/);

    const again = await post(page, body);
    expect(again.status).toBe(200);
    expect(again.json).toMatchObject({ reportId: first.json.reportId, investigationId: first.json.investigationId, replayed: true });

    const invalid = await post(page, { ...body, clientRequestId: crypto.randomUUID(), description: "smoke" });
    expect(invalid.status).toBe(400);
    expect(invalid.json.error.code).toBe("validation_failed");
    expect(Object.keys(invalid.json.error.fieldErrors)).toEqual(["description"]);
  });
});
