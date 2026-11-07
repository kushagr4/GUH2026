/**
 * Normalise free text for near-duplicate comparison: Unicode NFKD, strip
 * diacritics, lowercase, keep letters and digits, collapse whitespace.
 * The text is untrusted and only ever compared, never interpreted.
 */
export function normaliseText(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Set of character trigrams of an already-normalised string (padded with spaces). */
export function trigrams(normalised: string): Set<string> {
  const padded = ` ${normalised} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) grams.add(padded.slice(i, i + 3));
  return grams;
}

/** Jaccard similarity of two sets, 0..1. Two empty sets have similarity 0. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let intersection = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const gram of small) if (large.has(gram)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

/** Character-trigram Jaccard similarity of two raw texts, 0..1. */
export function textSimilarity(a: string, b: string): number {
  return jaccard(trigrams(normaliseText(a)), trigrams(normaliseText(b)));
}
