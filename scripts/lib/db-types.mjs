/**
 * The schema part of a generated database types file, with formatting removed.
 * Type generator versions differ in
 * quoting, commas, line wrapping, a `ComputedFields: never` member and the
 * `__InternalSupabase` hint, but agree on every table, column and type, which
 * is what this compares.
 * @param {string} text
 */
export function schemaSignature(text) {
  const flat = text
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\s+/g, "")
    .replace(/["';,()]/g, "")
    .replace(/ComputedFields:never/g, "")
    .replace(/__InternalSupabase:\{PostgrestVersion:[^}]*\}/g, "");
  const start = flat.indexOf("public:{Tables:");
  const end = flat.indexOf("typeDatabaseWithoutInternals");
  return start === -1 || end === -1 ? flat : flat.slice(start, end);
}
