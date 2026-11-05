import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readTestEnv } from "../support/test-env";
import {
  createAdmin,
  createAnon,
  createTestUser,
  cleanupTestUser,
  type TestUser,
} from "../support/test-users";

const env = readTestEnv();
const BUCKET = "dev-smoke-private";

function textFile(content = "hello") {
  return new Blob([content], { type: "text/plain" });
}

describe.skipIf(!env)("private storage on the hosted project", () => {
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    [alice, bob] = await Promise.all([createTestUser(env!), createTestUser(env!)]);
  });

  afterAll(async () => {
    await Promise.all([
      alice && cleanupTestUser(env!, alice),
      bob && cleanupTestUser(env!, bob),
    ]);
  });

  async function aliceUpload() {
    const path = `${alice.id}/${crypto.randomUUID()}.txt`;
    const { error } = await alice.client.storage.from(BUCKET).upload(path, textFile());
    expect(error).toBeNull();
    return path;
  }

  // Without the secret key, `npm run db:audit` makes the same check.
  it.skipIf(!env?.secretKey)("keeps the buckets private with size limits", async () => {
    const { data, error } = await createAdmin(env!).storage.listBuckets();
    expect(error).toBeNull();
    for (const id of [BUCKET, "user-uploads"]) {
      const bucket = data?.find((candidate) => candidate.id === id);
      expect(bucket, `bucket ${id} should exist`).toBeDefined();
      expect(bucket?.public).toBe(false);
      expect(bucket?.file_size_limit).toBeGreaterThan(0);
    }
  });

  it("lets an owner upload, list, download, sign and delete", async () => {
    const path = await aliceUpload();
    const storage = alice.client.storage.from(BUCKET);

    const listed = await storage.list(alice.id);
    expect(listed.data?.map((file) => `${alice.id}/${file.name}`)).toContain(path);

    const downloaded = await storage.download(path);
    expect(await downloaded.data?.text()).toBe("hello");

    const signed = await storage.createSignedUrl(path, 30);
    expect(signed.error).toBeNull();
    const response = await fetch(signed.data!.signedUrl);
    expect(response.status).toBe(200);

    expect((await storage.remove([path])).error).toBeNull();
    const afterDelete = await storage.list(alice.id);
    expect(afterDelete.data?.map((file) => file.name)).not.toContain(path.split("/")[1]);
  });

  it("stops another user reading, listing, signing or deleting an owner's file", async () => {
    const path = await aliceUpload();
    const storage = bob.client.storage.from(BUCKET);

    expect((await storage.download(path)).error).not.toBeNull();
    expect((await storage.createSignedUrl(path, 30)).error).not.toBeNull();
    expect((await storage.list(alice.id)).data ?? []).toEqual([]);

    await storage.remove([path]);
    const stillThere = await alice.client.storage.from(BUCKET).download(path);
    expect(stillThere.error).toBeNull();
  });

  it("stops a user writing into someone else's folder", async () => {
    const { error } = await bob.client.storage
      .from(BUCKET)
      .upload(`${alice.id}/planted.txt`, textFile());
    expect(error).not.toBeNull();
  });

  it("stops anonymous visitors reading or uploading", async () => {
    const path = await aliceUpload();
    const storage = createAnon(env!).storage.from(BUCKET);

    expect((await storage.download(path)).error).not.toBeNull();
    expect(
      (await storage.upload(`${alice.id}/anon.txt`, textFile())).error,
    ).not.toBeNull();
  });

  it("does not serve files through a public URL", async () => {
    const path = await aliceUpload();
    const { data } = alice.client.storage.from(BUCKET).getPublicUrl(path);
    const response = await fetch(data.publicUrl);
    expect(response.ok).toBe(false);
  });

  it("rejects files over the bucket's size limit", async () => {
    const tooBig = new Blob([new Uint8Array(1024 * 1024 + 1)], { type: "text/plain" });
    const { error } = await alice.client.storage
      .from(BUCKET)
      .upload(`${alice.id}/too-big.txt`, tooBig);
    expect(error).not.toBeNull();
  });

  it("rejects file types the bucket does not allow", async () => {
    const { error } = await alice.client.storage
      .from(BUCKET)
      .upload(
        `${alice.id}/page.html`,
        new Blob(["<script>alert(1)</script>"], { type: "text/html" }),
      );
    expect(error).not.toBeNull();
  });
});
