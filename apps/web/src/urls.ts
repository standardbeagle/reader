export function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96)
    .replace(/-+$/g, "");
  return slug || "item";
}

/** A readable key with the stable id retained for exact client-side routing. */
export function routeKey(label: string, id: string): string {
  return `${slugify(label)}--${id}`;
}

export function idFromRouteKey(value: string): string {
  const marker = value.lastIndexOf("--");
  return marker >= 0 ? value.slice(marker + 2) : value;
}
