/**
 * Whether a page's response headers let another site show it in an iframe,
 * following the browser's rules: a CSP `frame-ancestors` directive, when any
 * policy has one, decides alone and X-Frame-Options is ignored; otherwise
 * X-Frame-Options DENY or SAMEORIGIN blocks. reader is always a different
 * origin from the article, so 'self' and host lists without `*` block too
 * (a publisher allow-listing a reader install is not a case worth guessing at).
 * Returns the reason framing is refused, or null when it is allowed.
 */
export function frameBlockReason(headers: Headers): string | null {
  // Multiple CSP headers arrive comma-joined; each policy is enforced.
  const policies = (headers.get("content-security-policy") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  let sawFrameAncestors = false;
  for (const policy of policies) {
    const directive = policy.split(";").map((d) => d.trim()).find((d) => /^frame-ancestors(\s|$)/i.test(d));
    if (!directive) continue;
    sawFrameAncestors = true;
    const sources = directive.split(/\s+/).slice(1).map((s) => s.toLowerCase());
    if (sources.includes("*")) continue;
    return sources.length === 0 || sources.includes("'none'")
      ? "its Content-Security-Policy forbids framing (frame-ancestors 'none')"
      : "its Content-Security-Policy only allows its own sites to frame it (frame-ancestors)";
  }
  if (sawFrameAncestors) return null;
  // Browsers ignore unknown X-Frame-Options values (ALLOW-FROM included).
  const xfo = (headers.get("x-frame-options") ?? "").toLowerCase();
  if (/\bdeny\b/.test(xfo)) return "it sends X-Frame-Options: DENY";
  if (/\bsameorigin\b/.test(xfo)) return "it sends X-Frame-Options: SAMEORIGIN";
  return null;
}
