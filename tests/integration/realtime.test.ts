import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTestEnv } from "../support/test-env";
import {
  createAnon,
  createTestUser,
  cleanupTestUser,
  type TestClient,
  type TestUser,
} from "../support/test-users";

const env = readTestEnv();

type Row = { id: string; title: string; owner_id: string };
type Change = RealtimePostgresChangesPayload<Row>;

function subscribe(
  client: TestClient,
  name: string,
  onChange: (payload: Change) => void,
  filter?: string,
): Promise<RealtimeChannel> {
  return new Promise((resolve, reject) => {
    const channel = client
      // Same as useTableChanges: SUBSCRIBED only once the server confirms the
      // subscription, CHANNEL_ERROR if it refuses it.
      .channel(name, { config: { postgres_changes_options: { wait: true } } })
      .on<Row>(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "dev_smoke_records",
          ...(filter ? { filter } : {}),
        },
        onChange,
      )
      .subscribe((status, error) => {
        if (status === "SUBSCRIBED") resolve(channel);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          reject(error ?? new Error(`Realtime ${status}`));
        }
      });
  });
}

async function waitFor(check: () => boolean, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting for a Realtime event.");
    await new Promise((done) => setTimeout(done, 100));
  }
}

describe.skipIf(!env)("Realtime on the hosted project", () => {
  let alice: TestUser;
  let bob: TestUser;
  const channels: Array<[TestClient, RealtimeChannel]> = [];

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createTestUser(env!), createTestUser(env!)]);
  });

  afterAll(async () => {
    for (const [client, channel] of channels) await client.removeChannel(channel);
    await Promise.all([
      alice && cleanupTestUser(env!, alice),
      bob && cleanupTestUser(env!, bob),
    ]);
  });

  it("delivers a user's own changes, and never their content to anyone else", async () => {
    const aliceEvents: Change[] = [];
    const bobEvents: Change[] = [];
    const anonEvents: Change[] = [];

    channels.push([
      alice.client,
      await subscribe(
        alice.client,
        "alice-own",
        (event) => aliceEvents.push(event),
        `owner_id=eq.${alice.id}`,
      ),
    ]);
    // Bob and an anonymous visitor deliberately subscribe with no filter, the
    // worst case for a leak. Both subscriptions are accepted; RLS must then
    // hide every row from them.
    channels.push([
      bob.client,
      await subscribe(bob.client, "bob-all", (event) => bobEvents.push(event)),
    ]);
    const anon = createAnon(env!);
    channels.push([
      anon,
      await subscribe(anon, "anon-all", (event) => anonEvents.push(event)),
    ]);

    const secret = `private title ${crypto.randomUUID()}`;
    const { data, error } = await alice.client
      .from("dev_smoke_records")
      .insert({ title: secret })
      .select("id")
      .single();
    expect(error).toBeNull();

    await waitFor(() => aliceEvents.some((event) => event.eventType === "INSERT"));
    const inserted = aliceEvents.find((event) => event.eventType === "INSERT");
    expect(inserted?.new).toMatchObject({ id: data!.id, title: secret });

    await alice.client
      .from("dev_smoke_records")
      .update({ title: `${secret} updated` })
      .eq("id", data!.id);
    await waitFor(() => aliceEvents.some((event) => event.eventType === "UPDATE"));

    await alice.client.from("dev_smoke_records").delete().eq("id", data!.id);

    // Allow time for any wrongly delivered events to arrive before asserting.
    await new Promise((done) => setTimeout(done, 3000));

    // Another signed-in user: RLS filters the changes out silently.
    expect(bobEvents.filter((event) => event.eventType === "INSERT")).toEqual([]);
    expect(bobEvents.filter((event) => event.eventType === "UPDATE")).toEqual([]);

    // An anonymous subscriber has no privileges on the table, so Realtime sends
    // it an empty "401 Unauthorized" notice instead: no row, no id, no timestamp.
    for (const event of anonEvents.filter((e) => e.eventType !== "DELETE")) {
      expect(event).toMatchObject({ new: {}, old: {}, commit_timestamp: null });
      expect((event as Change & { errors?: string[] }).errors).toContain(
        "Error 401: Unauthorized",
      );
    }

    // Postgres can't check RLS on a deleted row, so a DELETE event may reach
    // other subscribers. With the default replica identity it carries only the
    // primary key. Whatever arrives, no row content ever leaks.
    expect(JSON.stringify(bobEvents)).not.toContain(secret);
    expect(JSON.stringify(anonEvents)).not.toContain(secret);
  });

  it("refuses an anonymous visitor watching a user's rows", async () => {
    const anon = createAnon(env!);
    await expect(
      subscribe(anon, "anon-filtered", () => {}, `owner_id=eq.${alice.id}`),
    ).rejects.toThrow();
    await anon.removeAllChannels();
  });

  it("closes channels cleanly", async () => {
    const client = alice.client;
    const channel = await subscribe(client, "alice-temporary", () => {});
    expect(await client.removeChannel(channel)).toBe("ok");
  });
});
