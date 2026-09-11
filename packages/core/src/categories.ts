const MAX_CATEGORIES = 8;
const MAX_CATEGORY_LEN = 40;

/** Trimmed, de-duplicated subject tags, capped in count and length. */
export function limitCategories(names: Iterable<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const name of names) {
    const trimmed = name?.trim().slice(0, MAX_CATEGORY_LEN);
    if (trimmed) out.add(trimmed);
    if (out.size >= MAX_CATEGORIES) break;
  }
  return [...out];
}
