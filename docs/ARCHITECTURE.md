# Architecture

> The shape of Aether — written so a new contributor can find their way around in 15 minutes.

## Crate / package layout

```
ai_terminal/
├── src/                     # React frontend (Vite)
│   ├── components/          # UI: TitleBar, TabBar, Terminal, AISidebar…
│   ├── store/               # Zustand stores (sessions, ui)
│   ├── lib/                 # ipc, themes, helpers
│   └── styles.css           # Tailwind + design tokens
├── src-tauri/               # Rust core (Tauri 2)
│   ├── src/
│   │   ├── lib.rs           # Tauri builder, plugin wiring, command registry
│   │   ├── commands.rs      # `#[tauri::command]` glue (one per IPC entrypoint)
│   │   ├── error.rs         # AetherError + serde wiring
│   │   ├── session/
│   │   │   ├── manager.rs   # Map<id, SessionHandle> over local & SSH
│   │   │   ├── local.rs     # portable-pty driver (ConPTY on Windows)
│   │   │   └── remote.rs    # russh client + interactive shell channel
│   │   ├── ssh_config.rs    # ~/.ssh/config parser
│   │   └── vault.rs         # Keyring (DPAPI on Windows)
│   ├── Cargo.toml
│   └── tauri.conf.json
└── sidecar/                 # Node process hosting @cursor/sdk
    ├── src/
    │   ├── index.ts         # NDJSON RPC over stdio
    │   ├── rpc.ts           # method dispatch
    │   └── logger.ts
    └── package.json
```

## Process model

```
┌──────────────────────┐                  ┌──────────────────────┐
│  Renderer (WebView2) │  Tauri IPC       │  Aether (Rust)       │
│  React + xterm.js    │ <──────────────► │  PTY + SSH + vault   │
└──────────────────────┘                  └──────┬───────────────┘
                                                 │ NDJSON / stdio
                                                 ▼
                                          ┌──────────────────────┐
                                          │  Sidecar (Node)      │
                                          │  @cursor/sdk         │
                                          └──────────────────────┘
```

Three OS processes:

1. **Webview** — React UI rendered by WebView2.
2. **Aether (Rust)** — owns PTYs, SSH connections, the vault, and the sidecar lifecycle. Talks to the renderer via Tauri IPC and to the sidecar via JSON-RPC over stdio.
3. **Sidecar (Node 20+)** — single-purpose: host `@cursor/sdk`. Crashes here cannot crash the terminal.

## Data flow: opening a session

```
Renderer                 Rust                       OS / Network
   │                       │                              │
   │ invoke open_local ───►│                              │
   │                       │ portable-pty::native_pty… ──►│ ConPTY
   │                       │   spawn_command(shell)       │
   │                       │ assign UUID, store handle    │
   │ ◄── sessionId ────────│                              │
   │                       │ tokio::spawn read loop       │
   │ ◄── session:data:<id>─│ (emit per chunk)             │
   │                       │                              │
   │ invoke write_session  │                              │
   │  (id, "ls -la\r") ───►│ master_pty.write_all ───────►│
   │                       │                              │
```

SSH sessions follow the same shape, replacing `portable-pty` with a `russh` client and the data path with a `Channel<Msg>` from `channel_open_session() + request_shell()`.

## Session abstraction

Every session — local PTY or remote SSH — implements the same logical contract:

```rust
trait Session {
    async fn write(&mut self, data: &[u8]) -> AetherResult<()>;
    async fn resize(&mut self, cols: u16, rows: u16) -> AetherResult<()>;
    async fn close(&mut self) -> AetherResult<()>;
}
```

The `SessionManager` owns a `DashMap<String, SessionHandle>` and a parallel `DashMap` of `SessionRecord` metadata. Two emitters bridge to the renderer:

- `session:data:<id>` — string payload, raw bytes from the session.
- `session:exit:<id>` — i32 exit code.

## AI bridge (planned)

The Rust process spawns the sidecar via `tokio::process::Command::stdio(piped, piped, piped)`. Frames are NDJSON requests/responses; each request has an `id`, each response carries the same `id`.

The renderer calls Tauri commands like `ai_send`, which the Rust side serializes onto the sidecar's stdin. Streaming events (token-by-token output, tool calls) will flow back as `ai:event:<runId>` Tauri events.

## Threading

- Tokio multi-thread runtime drives all async I/O.
- PTY blocking reads run on `tokio::task::spawn_blocking` workers (portable-pty's `Read` impl is sync-only).
- `russh` is Tokio-native, so the SSH read loop is a normal `tokio::spawn`.

## Safety / supply chain

- No `unsafe` Rust in our code (we depend on FFI through portable-pty, but our own crate is `#![forbid(unsafe_code)]`-ready).
- All inbound SSH host keys currently TOFU-accepted (alpha gate). Pre-1.0: `known_hosts` verification + interactive prompt.
- Secrets land in the OS keyring only; never serialized to disk.
- CSP locked down (no `unsafe-eval`, no remote scripts).
