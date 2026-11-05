import { describe, expect, it } from "vitest";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  toPageRange,
} from "@/lib/db/pagination";
import { classifyDbError, fromPostgrest, toDbError } from "@/lib/db/result";

describe("toPageRange", () => {
  it("defaults to the first page", () => {
    expect(toPageRange()).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      from: 0,
      to: DEFAULT_PAGE_SIZE - 1,
    });
  });

  it("calculates inclusive offsets", () => {
    expect(toPageRange({ page: 3, pageSize: 10 })).toMatchObject({ from: 20, to: 29 });
  });

  it("never exceeds the maximum page size", () => {
    expect(toPageRange({ pageSize: 1_000_000 }).pageSize).toBe(MAX_PAGE_SIZE);
  });

  it.each([
    [{ page: 0 }],
    [{ page: -5 }],
    [{ page: Number.NaN }],
    [{ pageSize: 0 }],
    [{ pageSize: -1 }],
  ])("recovers from bad input %j", (input) => {
    const range = toPageRange(input);
    expect(range.from).toBeGreaterThanOrEqual(0);
    expect(range.to).toBeGreaterThanOrEqual(range.from);
  });
});

describe("db errors", () => {
  it.each([
    ["PGRST116", "not_found"],
    ["42501", "forbidden"],
    ["23505", "conflict"],
    ["23514", "validation"],
    ["PGRST301", "unauthorized"],
    ["PGRST001", "unavailable"],
    ["XX000", "unknown"],
    [undefined, "unknown"],
  ])("classifies %s as %s", (code, kind) => {
    expect(classifyDbError(code)).toBe(kind);
  });

  it("never passes the raw database message to the UI", () => {
    const error = toDbError({
      code: "42501",
      message: 'permission denied for table "secret_internal_name"',
    });
    expect(error.message).not.toContain("secret_internal_name");
    expect(error.code).toBe("42501");
  });
});

describe("fromPostgrest", () => {
  it("wraps data", () => {
    expect(fromPostgrest({ data: [1], error: null })).toEqual({ ok: true, data: [1] });
  });

  it("keeps an empty list as success", () => {
    expect(fromPostgrest({ data: [], error: null })).toEqual({ ok: true, data: [] });
  });

  it("wraps errors", () => {
    const result = fromPostgrest({ data: null, error: { code: "23505" } });
    expect(result).toMatchObject({ ok: false, error: { kind: "conflict" } });
  });

  it("treats a null result as not found", () => {
    const result = fromPostgrest({ data: null, error: null });
    expect(result).toMatchObject({ ok: false, error: { kind: "not_found" } });
  });
});
