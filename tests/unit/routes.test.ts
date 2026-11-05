import { describe, expect, it } from "vitest";
import {
  ROUTES,
  isDevPath,
  isProtectedPath,
  safeRedirectPath,
} from "@/lib/routes";

describe("safeRedirectPath", () => {
  it.each([
    ["/app/dashboard", "/app/dashboard"],
    ["/app/items?tab=2#top", "/app/items?tab=2#top"],
    ["/", "/"],
  ])("keeps the same-origin path %s", (input, expected) => {
    expect(safeRedirectPath(input)).toBe(expected);
  });

  it.each([
    ["//evil.test"],
    ["/\\evil.test"],
    ["https://evil.test"],
    ["evil.test"],
    ["javascript:alert(1)"],
    ["/app\nSet-Cookie: x=1"],
    [""],
    [null],
    [undefined],
    [42],
  ])("falls back to the dashboard for %s", (input) => {
    expect(safeRedirectPath(input)).toBe(ROUTES.dashboard);
  });

  it("uses the fallback the caller gives", () => {
    expect(safeRedirectPath("//evil.test", "/login")).toBe("/login");
  });
});

describe("route groups", () => {
  it("protects /app and everything under it", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/app/dashboard")).toBe(true);
    expect(isProtectedPath("/application")).toBe(false);
    expect(isProtectedPath("/")).toBe(false);
  });

  it("treats /dev and everything under it as dev tools", () => {
    expect(isDevPath("/dev")).toBe(true);
    expect(isDevPath("/dev/records")).toBe(true);
    expect(isDevPath("/developers")).toBe(false);
  });
});
