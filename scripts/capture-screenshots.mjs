// Capture product screenshots from the static demo via the Chrome DevTools
// Protocol. Starts headless Chrome itself, drives it over CDP (Node's built-in
// WebSocket), and saves PNGs into site/src/assets/screenshots/.
//
// Usage: node scripts/capture-screenshots.mjs [baseUrl]
//   baseUrl defaults to the local demo preview.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.argv[2] ?? "http://127.0.0.1:4815/reader/demo/";
const ONLY = process.argv[3] ?? null; // optional: shoot just this one name
const OUT = new URL("../site/src/assets/screenshots/", import.meta.url).pathname;
const DEBUG_PORT = 9333;

// Each shot runs in a fresh profile so localStorage choices (list/board view)
// never leak between shots.
const shots = [
  {
    name: "desktop-reader.png",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
    url: BASE,
    // Open the second article so the shot shows all three columns in use.
    act: `document.querySelectorAll('.list li button')[1].click()`,
    waitFor: `.list li button`,
    settleMs: 1500,
  },
  {
    name: "pinboard.png",
    viewport: { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false },
    url: BASE,
    pre: `localStorage.setItem('reader.articleView', 'board')`,
    // The Verge feed is image-led, so its cards show real heroes.
    act: `[...document.querySelectorAll('.sidebar li > button')].find(b =\u003e b.textContent.includes('The Verge')).click()`,
    waitFor: `.sidebar li > button`,
    settleMs: 12000, // external hero images are large and need time
  },
  {
    name: "mobile-article.png",
    viewport: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
    url: BASE,
    pre: `localStorage.removeItem('reader.articleView')`,
    act: `document.querySelectorAll('.list li button')[3].click()`,
    waitFor: `.list li button`,
    settleMs: 1500,
  },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let msgId = 0;
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
    for (const fn of listeners) fn(msg);
  };
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++msgId;
      pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  return new Promise((resolve) => {
    ws.onopen = () => resolve({ send, onEvent: (fn) => listeners.push(fn), close: () => ws.close() });
  });
}

async function newTab() {
  const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/new?about:blank`, { method: "PUT" });
  const target = await res.json();
  return target.webSocketDebuggerUrl;
}

async function waitForDebugger() {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("chrome did not expose the debug port");
}

const chrome = spawn("google-chrome", [
  "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=/tmp/opencode/shot-profile`,
  "about:blank",
], { stdio: "ignore" });
process.on("exit", () => chrome.kill("SIGKILL"));

await waitForDebugger();
mkdirSync(OUT, { recursive: true });

const cdp = await connect(await newTab());
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");

for (const shot of shots) {
  if (ONLY && shot.name !== ONLY) continue;
  console.log(`shooting ${shot.name}…`);
  await cdp.send("Emulation.setDeviceMetricsOverride", shot.viewport);
  let preId = null;
  if (shot.pre) {
    const r = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: shot.pre });
    preId = r.identifier;
  } else {
    // Shots without an explicit pre-script still start from clean storage.
    const r = await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: "localStorage.clear()" });
    preId = r.identifier;
  }
  const loaded = new Promise((resolve) => {
    cdp.onEvent((msg) => { if (msg.method === "Page.loadEventFired") resolve(); });
    setTimeout(resolve, 10_000);
  });
  await cdp.send("Page.navigate", { url: shot.url });
  await loaded;
  await sleep(1800); // react render + demo seed chunk
  if (shot.act && shot.waitFor) {
    // Poll until the target exists, then act — the demo seed chunk loads async.
    await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression: `new Promise((resolve) => {
        const tryAct = () => {
          if (document.querySelector(${JSON.stringify(shot.waitFor)})) { ${shot.act}; resolve(true); }
          else setTimeout(tryAct, 250);
        };
        tryAct();
      })`,
    });
    await sleep(shot.settleMs);
  } else {
    await sleep(shot.settleMs);
  }
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${OUT}${shot.name}`, Buffer.from(data, "base64"));
  console.log(`saved ${shot.name}`);
  await cdp.send("Page.removeScriptToEvaluateOnNewDocument", { identifier: preId });
}

cdp.close();
chrome.kill("SIGKILL");
process.exit(0);
