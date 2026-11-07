// Seeded pseudo-random numbers for the network simulator, so a scenario with
// loss, duplication and jitter replays identically from the same seed.
// mulberry32: small and fast, fine for simulation, not for anything secret.

export type Random = {
  /** A number in [0, 1). */
  next(): number;
  /** True with the given probability. Always false at 0 and always true at 1. */
  chance(probability: number): boolean;
  /** An integer in [min, max], inclusive. */
  int(min: number, max: number): number;
};

export function createRandom(seed: number): Random {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    chance: (probability) => (probability <= 0 ? false : probability >= 1 ? true : next() < probability),
    int: (min, max) => (max <= min ? min : min + Math.floor(next() * (max - min + 1))),
  };
}
