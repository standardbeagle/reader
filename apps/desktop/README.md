# @reader/desktop

Electron shell that forks the local reader server (`packages/server`) and loads the web UI.

## Dev setup

better-sqlite3 is a native module and must be rebuilt for Electron's ABI before
running the desktop app:

    pnpm --filter @reader/desktop exec electron-rebuild -f -w better-sqlite3

This breaks the Node binding used by tests; restore it afterwards with
`pnpm install` (or `pnpm rebuild better-sqlite3` / prebuild-install).
