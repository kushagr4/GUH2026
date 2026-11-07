import { expect, test, type Page } from "@playwright/test";
import { readTestEnv, SKIP_REASON } from "../tests/support/test-env";
import {
  cleanupTestUser,
  createTestUser,
  newTestEmail,
  type TestUser,
} from "../tests/support/test-users";

const env = readTestEnv();

/**
 * The whole product journey against the shared hosted project, using disposable
 * users. One test leads into the next, so they run in order.
 */
test.describe("hosted journey", () => {
  test.skip(!env, SKIP_REASON);
  test.describe.configure({ mode: "serial" });

  let user: TestUser;

  test.beforeAll(async () => {
    user = await createTestUser(env!);
  });

  test.afterAll(async () => {
    if (user) await cleanupTestUser(env!, user);
  });

  async function signIn(page: Page, next?: string) {
    await page.goto(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    // Wait for the redirect. Navigating away sooner cancels the sign-in request
    // before its session cookies are set.
    await page.waitForURL(/\/app\//);
  }

  test("rejects a wrong password with a friendly message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill("wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Incorrect email or password.")).toBeVisible();
  });

  test("signs in, keeps the session across reloads, and signs out", async ({ page }) => {
    await signIn(page);
    await expect(page).toHaveURL(/\/app\/dashboard/);
    await expect(page.getByTestId("user-email")).toHaveText(user.email);

    await page.reload();
    await expect(page.getByTestId("user-email")).toHaveText(user.email);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/app/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("returns to the page the visitor first asked for", async ({ page }) => {
    await signIn(page, "/app/account");
    await expect(page).toHaveURL(/\/app\/account/);
  });

  test("a new visitor can sign up and go straight in, with no email", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(newTestEmail());
    await page.getByLabel("Password").fill(`Test-${crypto.randomUUID()}`);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/app\/dashboard/);
    // The sweep at the start of the next integration run removes this user.
  });

  test("saves a profile", async ({ page }) => {
    await signIn(page, "/app/account");
    await page.getByLabel("Display name").fill("Playwright");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText("Saved.")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Display name")).toHaveValue("Playwright");
  });

  test("diagnostics report healthy services and reveal no credentials", async ({ page }) => {
    await signIn(page);
    await page.goto("/dev");
    const list = page.getByTestId("diagnostics");
    for (const name of ["Environment", "Auth", "Session", "Database", "Storage"]) {
      await expect(list.locator(`[data-check="${name}"]`)).toHaveAttribute(
        "data-status",
        "pass",
      );
    }

    const html = await page.content();
    expect(html).not.toContain("sb_secret_");
    if (env!.secretKey) expect(html).not.toContain(env!.secretKey);
    expect(await list.innerText()).not.toContain(env!.publishableKey);
  });

  test("creates, renames and deletes a protected record", async ({ page }) => {
    await signIn(page);
    await page.goto("/dev/records");

    const title = `E2E ${crypto.randomUUID()}`;
    await page.getByLabel("New record title").fill(title);
    await page.getByRole("button", { name: "Add record" }).click();
    const row = page.getByTestId("record-row").filter({ hasText: title });
    await expect(row).toBeVisible();

    const renamed = `${title} renamed`;
    page.once("dialog", (dialog) => dialog.accept(renamed));
    await row.getByRole("button", { name: "Rename" }).click();
    const renamedRow = page.getByTestId("record-row").filter({ hasText: renamed });
    await expect(renamedRow).toBeVisible();

    await page.reload();
    await expect(renamedRow).toBeVisible();

    await renamedRow.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(renamedRow).toHaveCount(0);
  });

  test("uploads, opens and deletes a private file", async ({ page, context }) => {
    await signIn(page);
    await page.goto("/dev/storage");

    await page.getByLabel(/Upload a small test file/).setInputFiles({
      name: "e2e-note.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("hello from playwright"),
    });
    const row = page.getByTestId("file-row").filter({ hasText: "e2e-note.txt" });
    await expect(row).toBeVisible();

    const popup = context.waitForEvent("page");
    await row.getByRole("button", { name: "Open" }).click();
    const opened = await popup;
    await opened.waitForLoadState();
    await expect(opened.locator("body")).toContainText("hello from playwright");
    await opened.close();

    await row.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Delete" }).click();
    await expect(row).toHaveCount(0);
  });

  test("rejects a disallowed file in the browser", async ({ page }) => {
    await signIn(page);
    await page.goto("/dev/storage");
    await page.getByLabel(/Upload a small test file/).setInputFiles({
      name: "page.html",
      mimeType: "text/html",
      buffer: Buffer.from("<script>alert(1)</script>"),
    });
    await expect(page.getByText("That file type is not allowed.")).toBeVisible();
  });

  test("shows a new row live over Realtime, with no reload", async ({ page }) => {
    await signIn(page);
    await page.goto("/dev/realtime");
    // "Live" only appears once the server has confirmed the subscription, so
    // there is no need to wait any longer before inserting.
    await expect(page.getByTestId("realtime-status")).toHaveText("Live", {
      timeout: 20_000,
    });
    await page.getByRole("button", { name: "Insert a test record" }).click();
    await expect(page.getByTestId("realtime-events")).toContainText("INSERT", {
      timeout: 20_000,
    });
  });

  test("lists optional integrations, off by default, without revealing values", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/dev/integrations");
    const list = page.getByTestId("integrations");
    // Says where the checks run from, because results depend on the environment.
    await expect(page.getByTestId("runtime")).toContainText("This machine, production build");
    // The E2E server blanks every integration variable, so nothing is spent here.
    for (const id of ["elevenlabs", "n8n", "firecrawl"]) {
      await expect(list.locator(`[data-integration="${id}"]`)).toHaveAttribute("data-state", "off");
    }
    await expect(list.locator('[data-integration="github"]')).toHaveAttribute("data-state", "ready");
    await expect(page.getByTestId("elevenlabs-check").getByRole("button", { name: "Speak" })).toBeDisabled();
    await expect(page.getByTestId("n8n-check").getByRole("button", { name: "Send test event" })).toBeDisabled();
    await expect(page.getByTestId("firecrawl-check").getByRole("button", { name: "Scrape" })).toBeDisabled();
    expect(await page.content()).not.toMatch(/\bfc-[a-f0-9]{32}\b|\bsk_[a-f0-9]{48}\b|github_pat_|ghp_/);
  });

  test("streams an AI reply through the authenticated route (mock provider)", async ({
    page,
  }) => {
    await signIn(page);
    await page.goto("/dev/ai");
    await page.getByLabel("Prompt").fill("ping");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByTestId("ai-output")).toHaveText("[mock AI] You said: ping");
  });
});
