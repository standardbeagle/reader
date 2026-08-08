const HTML_TAG_RE = /<\s*\/?\s*[a-z][^>]*>/i;

const HTML_ENTITIES: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  hellip: "…",
  ldquo: "“",
  lt: "<",
  mdash: "—",
  nbsp: "\u00a0",
  ndash: "–",
  quot: '"',
  rdquo: "”",
  rsquo: "’",
  lsquo: "‘",
};

export function looksLikeHtml(value: string | null | undefined): boolean {
  return Boolean(value && HTML_TAG_RE.test(value));
}

/** Decode entities that frequently remain in plain-text feed bodies. */
export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z][a-z0-9]+);/gi, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized.startsWith("#x")) {
      const codePoint = Number.parseInt(normalized.slice(2), 16);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    if (normalized.startsWith("#")) {
      const codePoint = Number.parseInt(normalized.slice(1), 10);
      return isValidCodePoint(codePoint) ? String.fromCodePoint(codePoint) : entity;
    }
    return HTML_ENTITIES[normalized] ?? entity;
  });
}

function isValidCodePoint(value: number): boolean {
  return Number.isInteger(value)
    && value >= 0
    && value <= 0x10ffff
    && (value < 0xd800 || value > 0xdfff);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Preserve a plain-text feed body as readable, safe HTML. */
export function plainTextToHtml(value: string): string {
  const normalized = decodeHtmlEntities(value).replace(/\r\n?/g, "\n").trim();
  if (!normalized) return "";
  return normalized
    .split(/\n{2,}/)
    .map((paragraph) => `<p class="feed-plain-text">${escapeHtml(paragraph).replaceAll("\n", "<br>")}</p>`)
    .join("");
}
