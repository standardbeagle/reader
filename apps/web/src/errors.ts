export interface ErrorInfo { title: string; explanation: string; steps: string[] }

const catalog: Record<string, ErrorInfo> = {
  invalid_url: {
    title: "That doesn't look like a URL",
    explanation: "Feed addresses must start with http:// or https://.",
    steps: [
      "Paste the full address, including the https:// part",
      "You can paste a site's homepage — we'll find its feeds automatically",
    ],
  },
  duplicate: {
    title: "Already subscribed",
    explanation: "This feed is already in your subscription list, possibly under a different title than you expected.",
    steps: ["Look for it in the sidebar — the feed's own title is shown, not the URL"],
  },
  feed_fetch_failed: {
    title: "Couldn't fetch that address",
    explanation: "The server didn't return a readable response. The site may be down, blocking automated readers, or the address may be incorrect.",
    steps: [
      "Open the address in a new browser tab to check it loads",
      "Paste the site's homepage instead of a guessed feed URL — we'll search it for feeds",
      "If the site blocks automated access, look for an official mirror or newsletter",
    ],
  },
  no_feeds_found: {
    title: "No feeds found on that site",
    explanation: "We checked the page's metadata and the common feed locations, but this site doesn't appear to publish an RSS or Atom feed.",
    steps: [
      "Look for an RSS icon or a “Subscribe” link on the site and paste that URL",
      "Try a section page like /blog — some sites only feed specific sections",
      "Sites without feeds can be followed through a feed-generator service",
    ],
  },
  network: {
    title: "Can't reach the reader server",
    explanation: "Your browser couldn't contact the reader backend. It may have stopped or restarted.",
    steps: [
      "Wait a few seconds and try again",
      "On the desktop app, restart it; on a server, check the reader service status",
    ],
  },
  unknown: {
    title: "Something went wrong",
    explanation: "An unexpected error occurred.",
    steps: ["Try again", "If it keeps happening, check the server logs"],
  },
};

export function describeError(code: string | null): ErrorInfo {
  return (code && catalog[code]) || catalog.unknown!;
}
