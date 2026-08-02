import { app, BrowserWindow } from "electron";
import { fork, type ChildProcess } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

let server: ChildProcess | null = null;

function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const repoRoot = join(app.getAppPath(), "../..");
    const require = createRequire(import.meta.url);
    const tsx = join(dirname(require.resolve("tsx/package.json")), "dist", "cli.mjs");
    const entry = join(repoRoot, "packages/server/src/index.ts");
    server = fork(entry, [], {
      execPath: process.execPath,
      execArgv: [tsx],
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        READER_DB: join(app.getPath("userData"), "reader.db"),
        READER_PORT: "0",
        READER_WEB_DIST: join(repoRoot, "apps/web/dist"),
      },
      stdio: ["ignore", "pipe", "inherit", "ipc"],
    });
    const rl = createInterface({ input: server.stdout! });
    const timeout = setTimeout(() => reject(new Error("server start timeout")), 15_000);
    rl.on("line", (line) => {
      const m = /^READER_PORT=(\d+)$/.exec(line.trim());
      if (m) { clearTimeout(timeout); resolve(Number(m[1])); }
    });
    server.on("exit", (code) => reject(new Error(`server exited early: ${code}`)));
  });
}

app.whenReady().then(async () => {
  const port = await startServer();
  const win = new BrowserWindow({ width: 1280, height: 800, autoHideMenuBar: true });
  const devUrl = process.env.READER_WEB_DEV_URL;
  await win.loadURL(devUrl ?? `http://127.0.0.1:${port}`);
});

app.on("window-all-closed", () => {
  server?.kill();
  app.quit();
});
