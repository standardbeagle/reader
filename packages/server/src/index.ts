import { createServer } from "./api/server.js";

// Forked by Electron: self-exit if the parent's IPC channel goes away (e.g. SIGKILL).
if (process.send) process.on("disconnect", () => process.exit(0));

const dbPath = process.env.READER_DB ?? "reader.db";
const app = await createServer({ dbPath });

const port = await app.listen({ port: Number(process.env.READER_PORT ?? 0), host: "127.0.0.1" });
// Electron parent parses this line to learn the actual port.
console.log(`READER_PORT=${new URL(port).port}`);
