import { describe, expect, it } from "vitest";
import { findSecrets } from "../../scripts/scan-secrets.mjs";

// Fake credentials are assembled at runtime so this file can't trip the scanner.
const join = (...parts: string[]) => parts.join("");

describe("findSecrets", () => {
  it.each([
    ["Supabase secret key", join("sb_", "secret_", "abcdefghijklmnop")],
    ["Supabase access token", join("sbp_", "a".repeat(40))],
    ["JWT", join("eyJ", "abcdefghijkl", ".eyJ", "abcdefghijkl", ".", "abcdefghijkl")],
    ["Anthropic API key", join("sk-", "ant-", "abcdefghijklmnop")],
    ["GitHub token", join("gh", "o_", "a".repeat(36))],
    ["AWS access key", join("AK", "IA", "ABCDEFGHIJKLMNOP")],
    ["Private key", join("-----BEGIN ", "RSA PRIVATE KEY-----")],
    ["Database URL", join("postgresql", "://postgres:", "hunter2hunter2", "@db.abc.supabase.co")],
  ])("detects a %s", (_label, secret) => {
    expect(findSecrets(`value=${secret}`)).not.toEqual([]);
  });

  it.each([
    ["a publishable key", join("sb_", "publishable_", "abcdefghijklmnop")],
    ["the .env.example placeholders", "https://your-project-ref.supabase.co your-publishable-key"],
    ["a project URL", "https://abcdefgh.supabase.co"],
    ["a database URL placeholder", "postgresql://postgres:[PASSWORD]@db.abc.supabase.co"],
    ["ordinary code", "const supabase = createClient(url, key);"],
  ])("does not flag %s", (_label, text) => {
    expect(findSecrets(text)).toEqual([]);
  });
});
