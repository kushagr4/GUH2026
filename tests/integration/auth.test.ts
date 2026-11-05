import { afterAll, describe, expect, it } from "vitest";
import { readTestEnv } from "../support/test-env";
import {
  cleanupTestUser,
  createAnon,
  createTestUser,
  newTestEmail,
  type TestUser,
} from "../support/test-users";

const env = readTestEnv();

describe.skipIf(!env)("hosted auth", () => {
  const created: Array<{ id: string; client?: TestUser["client"] }> = [];

  afterAll(async () => {
    for (const user of created) await cleanupTestUser(env!, user);
  });

  async function user(): Promise<TestUser> {
    const newUser = await createTestUser(env!);
    created.push(newUser);
    return newUser;
  }

  it("issues verified claims for a signed-in user", async () => {
    const { client, id } = await user();
    const { data, error } = await client.auth.getClaims();
    expect(error).toBeNull();
    expect(data?.claims.sub).toBe(id);
    expect(data?.claims.role).toBe("authenticated");
  });

  it("signs in with the right password", async () => {
    const { email, password, id } = await user();
    const client = createAnon(env!);
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    expect(error).toBeNull();
    expect(data.user?.id).toBe(id);
  });

  it("rejects the wrong password", async () => {
    const { email } = await user();
    const { data, error } = await createAnon(env!).auth.signInWithPassword({
      email,
      password: "definitely-wrong-password",
    });
    expect(error?.code).toBe("invalid_credentials");
    expect(data.session).toBeNull();
  });

  it("ends the session on sign-out", async () => {
    const client = createAnon(env!);
    const { email, password } = await user();
    await client.auth.signInWithPassword({ email, password });
    expect((await client.auth.signOut()).error).toBeNull();
    const { data } = await client.auth.getSession();
    expect(data.session).toBeNull();
  });

  // Guards the free-plan email restriction. The built-in mailer only reaches
  // organisation members, so "Confirm email" must be off for sign-ups to work.
  it("gives a new sign-up a session straight away, with no email needed", async () => {
    const client = createAnon(env!);
    const { data, error } = await client.auth.signUp({
      email: newTestEmail(),
      password: `Test-${crypto.randomUUID()}`,
    });

    if (data.user) created.push({ id: data.user.id });
    expect(
      error,
      'Sign-up failed. Turn off "Confirm email" (docs/supabase-setup.md).',
    ).toBeNull();
    expect(
      data.session,
      'No session returned, so "Confirm email" is still on (docs/supabase-setup.md).',
    ).not.toBeNull();
  });

  it("enforces the minimum password length", async () => {
    const { error } = await createAnon(env!).auth.signUp({
      email: newTestEmail(),
      password: "short",
    });
    expect(error?.code).toBe("weak_password");
  });

  it("does not let the publishable key use admin endpoints", async () => {
    const { error } = await createAnon(env!).auth.admin.listUsers();
    expect(error).not.toBeNull();
  });
});
