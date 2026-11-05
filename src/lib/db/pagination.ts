export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export type PageRange = {
  page: number;
  pageSize: number;
  /** Inclusive offsets for supabase-js `.range(from, to)`. */
  from: number;
  to: number;
};

/** Always returns a bounded range, so no query can pull a whole table by accident. */
export function toPageRange(
  input: { page?: number; pageSize?: number } = {},
): PageRange {
  const page = Math.max(1, Math.floor(input.page ?? 1) || 1);
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(input.pageSize ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE),
  );
  const from = (page - 1) * pageSize;
  return { page, pageSize, from, to: from + pageSize - 1 };
}
