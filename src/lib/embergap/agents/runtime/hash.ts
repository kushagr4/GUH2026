// Deterministic, dependency-free hashing for event integrity and replica digests.
// No node:crypto, so the runtime also runs in the browser and in worker threads.
// FNV-1a is not a security primitive: it detects accidental divergence between
// replicas, not tampering. See docs/embergap-data-runtime.md.

/** JSON with object keys sorted at every level, so equal values give equal text. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new TypeError("stableStringify: non-finite numbers are not valid JSON");
    }
    if (value === undefined || typeof value === "function" || typeof value === "symbol") {
      throw new TypeError(`stableStringify: ${typeof value} is not valid JSON`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item ?? null)).join(",")}]`;
  // Dates, Maps, class instances and the like don't survive a JSON round trip
  // unchanged, so a hash of them would differ between sender and receiver.
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("stableStringify: only plain objects, arrays and JSON primitives are allowed");
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

/** 64-bit FNV-1a as 16 hex characters, computed with two 32-bit halves. */
export function fnv1a64(text: string): string {
  // Offset basis 0xcbf29ce484222325, prime 0x100000001b3, on UTF-16 code units.
  let high = 0xcbf29ce4;
  let low = 0x84222325;
  for (let index = 0; index < text.length; index += 1) {
    // `^` yields a signed 32-bit value; keep `low` unsigned so the carry is right.
    low = (low ^ text.charCodeAt(index)) >>> 0;
    // Multiply (high, low) by the prime: high*2^32 + low times 2^40 + 0x1b3.
    const lowTimesSmall = low * 0x1b3;
    const carry = Math.floor(lowTimesSmall / 0x100000000);
    const newLow = lowTimesSmall >>> 0;
    const newHigh = (high * 0x1b3 + (low << 8) + carry) >>> 0;
    high = newHigh;
    low = newLow;
  }
  return high.toString(16).padStart(8, "0") + low.toString(16).padStart(8, "0");
}

export function hashValue(value: unknown): string {
  return fnv1a64(stableStringify(value));
}
