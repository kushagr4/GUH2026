import { describe, expect, it } from "vitest";
import { localSettings, parseStatusEnv } from "../../scripts/local-supabase.mjs";
describe("local Supabase settings", () => {
  const data = "API_URL=http://127.0.0.1:54321\nANON_KEY=public\nSERVICE_ROLE_KEY=private";
  it("extracts only local public credentials", () => {
    expect(localSettings(data)).toEqual({url:"http://127.0.0.1:54321",key:"public"});
  });
  it("recognizes the new publishable key format", () => {
    expect(localSettings("API_URL=http://localhost:54321\nPUBLISHABLE_KEY=sb_publishable_demo").key).toBe("sb_publishable_demo");
  });
  it("rejects a cloud endpoint", () => {
    expect(() => localSettings("API_URL=https://abc.supabase.co\nANON_KEY=public")).toThrow();
  });
  it("never accepts the service role key", () => {
    expect(() => localSettings("API_URL=http://127.0.0.1:54321\nANON_KEY=same\nSERVICE_ROLE_KEY=same")).toThrow();
  });
  it("handles quoted values", () => {
    expect(parseStatusEnv('API_URL="http://127.0.0.1:54321"')).toHaveProperty("API_URL", "http://127.0.0.1:54321");
  });
});
