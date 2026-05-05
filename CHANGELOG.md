# Changelog

All notable changes to Aether are documented here. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-05-05

First public alpha. The full vertical slice — terminal, SSH, AI, splits —
is wired end-to-end and exercised by 50+ automated tests.

### Added
- **Local PTY sessions** via `portable-pty` (ConPTY on Windows).
  Round-trip pinned by an integration test.
- **SSH client** via `russh` 0.46:
  - Auth chain: explicit key file → `~/.ssh/id_ed25519` → `id_ecdsa` →
    `id_rsa` → password (when typed).
  - `~/.ssh/config` parser with multi-alias `Host`, `=` separator,
    case-insensitive directives, wildcard host blocks. Quick-connect
    dialog reads it on every open.
  - `~/.ssh/known_hosts` verification with mismatch protection and
    trust-on-first-use; rejected mismatches log a clear warning.
- **Encrypted credential vault** via the OS keyring (DPAPI on Windows,
  Keychain on macOS, libsecret on Linux), with an in-process cache that
  keeps tokens reachable even when the backend reads back as `NoEntry`
  (a known Windows Credential Manager quirk).
- **AI sidebar powered by `@cursor/sdk` 1.0.x**:
  - One-click sign-in with your Cursor account: dialog opens
    `cursor.com/dashboard/integrations`, you paste a `crsr_…` API key
    once, Aether validates by spawning a Cursor agent, then stores it.
  - **Streaming output** — token-by-token text plus status events
    (thinking, tool calls) via the SDK's `run.stream()`.
  - JWT detection: pasting an IDE session token surfaces a clear
    "needs an API key" message with a one-click jump back to the
    dashboard.
  - Sidecar isolation: the `@cursor/sdk` runs in a separate Node 22
    process; misbehaving agents cannot crash the terminal.
- **Split panes**, horizontal and vertical, with drag-resize:
  - `Ctrl + \` split right, `Ctrl + Shift + \` split down,
    `Ctrl + Shift + W` close active pane.
  - Splitting an SSH pane opens a second connection to the same host
    with the same auth — no quick-connect re-prompt.
  - Splits compose arbitrarily; tabs with multiple panes show a
    `▥ N` pill.
  - Layout persistence is per-tab; closing the last pane closes the tab.
- **Tabs, command palette, quick-connect, themes** (4 themes shipped:
  Midnight, Monokai Pro, Dracula, Tokyo Night).
- **Frameless window with custom title bar**, drag region,
  min/max/close buttons.
- **WebGL terminal renderer** via the official `xterm-addon-webgl`,
  with sane fallbacks if GPU is unavailable.

### Architecture
- Tauri 2 host process (Rust + WebView2).
- React 18 + Vite renderer with Tailwind 4 design tokens.
- A single Rust `Session` abstraction over local PTY and remote SSH.
- Single-task-owns-channel pattern for SSH — fixed an early deadlock
  where the read loop's `channel.wait().await` blocked outgoing writes.
- Layout/sessions split into independent Zustand stores so the layout
  tree (per tab) is decoupled from session lifecycle.

### Test surface
- 29 Rust unit + 2 Rust integration tests (incl. real ConPTY round-trip).
- 22 frontend tests covering layout split/close/resize/clamp logic,
  sessions add/remove/patch, and an IPC contract test that asserts every
  backend command has a frontend wrapper.
- 9 sidecar tests for the JSON-RPC dispatcher: ping, unknown method,
  agent.create/send/dispose flows, CursorAgentError surface.
- `cargo clippy --all-targets -- -D warnings`, `cargo fmt --check`,
  `eslint`, `tsc -b --noEmit` — all clean across the three test stacks.

### Known limitations / scoped for later
- Cross-launch token persistence falls back to keyring only; on Windows
  installs where `CredWrite` reads back as `NoEntry`, you re-paste the
  API key once per Aether launch. A DPAPI-encrypted file fallback is
  planned for 0.1.1.
- SSH agent auth (Pageant / OpenSSH-Agent) is not yet wired; default
  keys + explicit key file + password cover the common path.
- `cursor-agent login` browser flow produces a JWT the public SDK
  doesn't accept; the in-app paste flow is the supported path. The
  Install Cursor CLI button is provided for completeness only.
- The placeholder app icon ships from the `scripts/generate-placeholder-icon.ps1`
  generator. Drop your art at `assets/icon.png` and re-run
  `npm run icons` to rebrand.

### Platform
Built and tested on Windows 11 24H2 with WebView2 Runtime (preinstalled
on Win 11). macOS and Linux builds are mechanically supported by the
Tauri 2 build system but have not been smoke-tested for 0.1.0.
