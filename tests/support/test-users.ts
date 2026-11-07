import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../src/lib/supabase/database.types";
import type { TestEnv } from "./test-env";

/**
 * The team shares one project on the free plan, so tests never touch existing data.
 * Each test creates throwaway users with this prefix and cleans up after itself.
 * Cleanup only ever acts on addresses that match the exact pattern.
 */
const EMAIL_PREFIX = "guh-test+";
const EMAIL_DOMAIN = "@example.test";
const STALE_AFTER_MS = 30 * 60 * 1000;
const BUCKETS = ["dev-smoke-private", "user-uploads", "embergap-report-media"];

export type TestClient = SupabaseClient<Database>;

export type TestUser = {
  id: string;
  email: string;
  password: string;
  client: TestClient;
};

export function isTestEmail(email: string | undefined): boolean {
  return Boolean(email?.startsWith(EMAIL_PREFIX) && email.endsWith(EMAIL_DOMAIN));
}

export function newTestEmail(): string {
  return `${EMAIL_PREFIX}${crypto.randomUUID()}${EMAIL_DOMAIN}`;
}

const NO_PERSIST = {
  auth: { autoRefreshToken: false, persistSession: false },
};

export function createAdmin(env: TestEnv): TestClient {
  if (!env.secretKey) throw new Error("This check needs SUPABASE_TEST_SECRET_KEY.");
  return createClient<Database>(env.url, env.secretKey, NO_PERSIST);
}

export function createAnon(env: TestEnv): TestClient {
  return createClient<Database>(env.url, env.publishableKey, NO_PERSIST);
}

/**
 * Signs up through the public API, exactly as a real visitor would. This relies on
 * "Confirm email" being off, which is the required setting for this project.
 */
export async function createTestUser(env: TestEnv): Promise<TestUser> {
  const email = newTestEmail();
  const password = `Test-${crypto.randomUUID()}`;
  const client = createAnon(env);

  const { data, error } = await client.auth.signUp({ email, password });
  if (error || !data.user) {
    throw new Error(`Could not create a test user: ${error?.code ?? error?.message}`);
  }
  if (!data.session) {
    throw new Error('No session after sign-up. Turn off "Confirm email" (docs/supabase-setup.md).');
  }
  return { id: data.user.id, email, password, client };
}

/**
 * Removes everything a test user owns. Without a secret key the empty account
 * stays until the owner runs `npm run db:sweep-tests`. It holds no data.
 */
export async function cleanupTestUser(
  env: TestEnv,
  user: { id: string; client?: TestClient },
): Promise<void> {
  if (user.client) {
    for (const bucket of BUCKETS) {
      const { data: files } = await user.client.storage
        .from(bucket)
        .list(user.id, { limit: 100 });
      if (files?.length) {
        await user.client.storage
          .from(bucket)
          .remove(files.map((file) => `${user.id}/${file.name}`));
      }
    }
    await user.client.from("dev_smoke_records").delete().eq("owner_id", user.id);
    await user.client.from("profiles").delete().eq("id", user.id);
  }

  if (!env.secretKey) return;

  const admin = createAdmin(env);
  const { data } = await admin.auth.admin.getUserById(user.id);
  if (!isTestEmail(data.user?.email)) {
    throw new Error("Refusing to delete a user that is not a test user.");
  }
  await admin.auth.admin.deleteUser(user.id);
}

/** Clears test users left behind by earlier runs. Needs the secret key. */
export async function sweepStaleTestUsers(env: TestEnv): Promise<number> {
  if (!env.secretKey) return 0;

  const admin = createAdmin(env);
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (error) throw new Error(`Could not list users: ${error.message}`);

  const stale = data.users.filter(
    (user) =>
      isTestEmail(user.email) &&
      Date.now() - new Date(user.created_at).getTime() > STALE_AFTER_MS,
  );
  for (const user of stale) {
    for (const bucket of BUCKETS) {
      const { data: files } = await admin.storage.from(bucket).list(user.id, { limit: 100 });
      if (files?.length) {
        await admin.storage.from(bucket).remove(files.map((file) => `${user.id}/${file.name}`));
      }
    }
    await admin.auth.admin.deleteUser(user.id);
  }
  return stale.length;
}
