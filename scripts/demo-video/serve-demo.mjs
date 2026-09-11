// Static server for the demo build, mounted at /reader/demo/ like GitHub Pages.
// The demo-video spec (demo.json) starts it as its upstream on port 4816.
//
// Recording the product video with agnt's demo engine:
//   VITE_DEMO=1 pnpm --filter @reader/web exec vite build --base=/reader/demo/ --outDir dist-demo --emptyOutDir
//   cd ~/work/core/agnt/docs-site/screenshots
//   env -u DISPLAY -u WAYLAND_DISPLAY node engine/demo.mjs <repo>/scripts/demo-video
//
// Unset the display variables on WSL: with WSLg's DISPLAY/WAYLAND_DISPLAY set,
// Playwright's Chromium produces almost no frames (a 5 s recording holds 24,
// screenshots time out, each synthetic mouse event waits seconds).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("../../apps/web/dist-demo/", import.meta.url).pathname;
const PREFIX = "/reader/demo/";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const path = new URL(req.url ?? "/", "http://x").pathname;
  if (!path.startsWith(PREFIX)) { res.writeHead(302, { location: PREFIX }).end(); return; }
  const rel = normalize(path.slice(PREFIX.length) || "index.html").replace(/^(\.\.[/\\])+/, "");
  const file = join(ROOT, rel.endsWith("/") ? `${rel}index.html` : rel);
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch {
    res.writeHead(200, { "content-type": "text/html" }).end(await readFile(join(ROOT, "index.html")));
  }
}).listen(4816, "127.0.0.1", () => console.log("demo on http://127.0.0.1:4816/reader/demo/"));
