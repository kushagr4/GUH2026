import { readTestEnv, SKIP_REASON } from "../support/test-env";
import { sweepStaleTestUsers } from "../support/test-users";

export default async function setup() {
  const env = readTestEnv();
  if (!env) {
    console.warn(`\n${SKIP_REASON}\n`);
    return;
  }
  const removed = await sweepStaleTestUsers(env);
  if (removed) console.log(`Removed ${removed} stale test user(s).`);
}
