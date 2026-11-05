import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTestEnv } from "../support/test-env";
import {
  createAdmin,
  createAnon,
  createTestUser,
  cleanupTestUser,
  type TestClient,
  type TestUser,
} from "../support/test-users";

const env = readTestEnv();
const PERMISSION_DENIED = "42501";

describe.skipIf(!env)("row level security on the hosted project", () => {
  let alice: TestUser;
  let bob: TestUser;
  let anon: TestClient;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createTestUser(env!), createTestUser(env!)]);
    anon = createAnon(env!);
  });

  afterAll(async () => {
    await Promise.all([
      alice && cleanupTestUser(env!, alice),
      bob && cleanupTestUser(env!, bob),
    ]);
  });

  async function aliceRecord(title = "alice's record") {
    const { data, error } = await alice.client
      .from("dev_smoke_records")
      .insert({ title })
      .select()
      .single();
    expect(error).toBeNull();
    return data!;
  }

  describe("dev_smoke_records", () => {
    it("stamps a new row with its creator", async () => {
      const record = await aliceRecord();
      expect(record.owner_id).toBe(alice.id);
    });

    it("refuses anonymous reads", async () => {
      await aliceRecord();
      const { data, error } = await anon.from("dev_smoke_records").select("id");
      expect(data ?? []).toEqual([]);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("refuses anonymous writes", async () => {
      const { error } = await anon
        .from("dev_smoke_records")
        .insert({ title: "from nobody" });
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("hides a row from another user", async () => {
      const record = await aliceRecord();
      const { data, error } = await bob.client
        .from("dev_smoke_records")
        .select("id")
        .eq("id", record.id);
      expect(error).toBeNull();
      expect(data).toEqual([]);
    });

    it("does not let another user update a row", async () => {
      const record = await aliceRecord("original");
      const { data } = await bob.client
        .from("dev_smoke_records")
        .update({ title: "hacked" })
        .eq("id", record.id)
        .select();
      expect(data).toEqual([]);

      const { data: after } = await alice.client
        .from("dev_smoke_records")
        .select("title")
        .eq("id", record.id)
        .single();
      expect(after?.title).toBe("original");
    });

    it("does not let another user delete a row", async () => {
      const record = await aliceRecord();
      const { data } = await bob.client
        .from("dev_smoke_records")
        .delete()
        .eq("id", record.id)
        .select();
      expect(data).toEqual([]);

      const { data: after } = await alice.client
        .from("dev_smoke_records")
        .select("id")
        .eq("id", record.id);
      expect(after).toHaveLength(1);
    });

    it("refuses a row created in someone else's name", async () => {
      const { error } = await bob.client
        .from("dev_smoke_records")
        .insert({ title: "impersonation", owner_id: alice.id });
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("refuses handing a row to someone else", async () => {
      const record = await aliceRecord();
      const { error } = await alice.client
        .from("dev_smoke_records")
        .update({ owner_id: bob.id })
        .eq("id", record.id);
      expect(error?.code).toBe(PERMISSION_DENIED);
    });

    it("runs the full owner lifecycle, including the updated_at trigger", async () => {
      const record = await aliceRecord("first");

      await new Promise((done) => setTimeout(done, 20));
      const updated = await alice.client
        .from("dev_smoke_records")
        .update({ title: "second" })
        .eq("id", record.id)
        .select()
        .single();
      expect(updated.error).toBeNull();
      expect(updated.data?.title).toBe("second");
      expect(new Date(updated.data!.updated_at).getTime()).toBeGreaterThan(
        new Date(record.updated_at).getTime(),
      );

      const removed = await alice.client
        .from("dev_smoke_records")
        .delete()
        .eq("id", record.id)
        .select();
      expect(removed.data).toHaveLength(1);
    });

    it("enforces the title length constraint", async () => {
      const { error } = await alice.client
        .from("dev_smoke_records")
        .insert({ title: "x".repeat(201) });
      expect(error?.code).toBe("23514");
    });

    it.skipIf(!env?.secretKey)("cascades a user's rows when the user is deleted", async () => {
      const temporary = await createTestUser(env!);
      const { data } = await temporary.client
        .from("dev_smoke_records")
        .insert({ title: "goes away" })
        .select("id")
        .single();
      const admin = createAdmin(env!);
      await admin.auth.admin.deleteUser(temporary.id);

      const { data: after } = await admin
        .from("dev_smoke_records")
        .select("id")
        .eq("id", data!.id);
      expect(after).toEqual([]);
    });
  });

  describe("profiles", () => {
    it("lets a user create and change only their own profile", async () => {
      const { error } = await alice.client
        .from("profiles")
        .upsert({ id: alice.id, display_name: "Alice" });
      expect(error).toBeNull();

      const { error: forged } = await bob.client
        .from("profiles")
        .upsert({ id: alice.id, display_name: "Not Alice" });
      expect(forged?.code).toBe(PERMISSION_DENIED);

      const { data } = await alice.client
        .from("profiles")
        .select("display_name")
        .eq("id", alice.id)
        .single();
      expect(data?.display_name).toBe("Alice");
    });

    it("hides a profile from other users and from anonymous visitors", async () => {
      await alice.client.from("profiles").upsert({ id: alice.id, display_name: "Alice" });

      const asBob = await bob.client.from("profiles").select("id").eq("id", alice.id);
      expect(asBob.data).toEqual([]);

      const asAnon = await anon.from("profiles").select("id");
      expect(asAnon.data ?? []).toEqual([]);
      expect(asAnon.error?.code).toBe(PERMISSION_DENIED);
    });
  });
});
