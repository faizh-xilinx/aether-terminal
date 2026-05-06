# Aether

> The AI-native SSH terminal.

Aether is a fast, beautiful, security-first SSH terminal with Cursor-powered AI woven through every interaction. Built with Tauri 2 + Rust + React, it loads in milliseconds, uses ~10x less memory than Electron alternatives, and treats AI as a first-class citizen — not a plugin.

**Status:** **0.1.0 alpha** — first public release. See [`CHANGELOG.md`](CHANGELOG.md).

## Why Aether

| | Tabby | Warp | iTerm2 | **Aether** |
|---|:-:|:-:|:-:|:-:|
| Native (non-Electron) | | yes | yes | **yes** |
| Open source | yes | | | **yes** |
| Cursor / agentic AI | | partial | | **yes** |
| First-class SSH UX | yes | partial | partial | **yes** |
| Inline diffs / structured output | | yes | | **yes** |
| Cross-platform | yes | yes | mac only | **yes** |
| MCP host + client | | | | **yes** |

## Highlights

- **Native performance.** Tauri 2 + Rust core. Cold start under 200 ms, idle RAM under 100 MB.
- **Cursor-powered AI.** One-click sign-in with your Cursor account email — no API key juggling. Inline "Fix with AI" on errors, natural-language → command, session summaries, host-aware Q&A. Powered by `@cursor/sdk` running in a sandboxed Node sidecar.
- **MCP host + client.** Aether ships a built-in MCP server that exposes remote-shell primitives so any agent (Cursor, Claude Desktop, Cline) can drive your terminal.
- **First-class SSH.** Reads `~/.ssh/config`, fuzzy quick-connect, key + agent + password auth, port forwards, SFTP browser, broadcast input across panes, auto-reconnect.
- **Encrypted vault.** Credentials encrypted via Windows DPAPI / macOS Keychain / libsecret. Never plaintext.
- **Slick UI.** Built on Radix + Tailwind. Ligatures, true color, sixel inline images, GPU-accelerated rendering via xterm.js WebGL.
- **Block-based output.** Each command is a block — copyable, searchable, AI-actionable.
- **Session recording.** Asciinema-compatible `.cast` output. Replay any session.
- **Workspaces & tabs.** Group hosts by project, restore on launch, drag-to-split panes.

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  Renderer (React 18 + TypeScript + Tailwind + Radix)         │
│  Tabs · Split panes · Command palette · AI sidebar · xterm   │
└───────────────────────┬──────────────────────────────────────┘
                        │ Tauri IPC (typed commands & events)
┌───────────────────────▼──────────────────────────────────────┐
│  Backend (Rust, Tauri 2)                                     │
│  ├─ PTY engine (portable-pty)                                │
│  ├─ SSH engine (russh + russh-keys + russh-sftp)             │
│  ├─ Vault (keyring + DPAPI)                                  │
│  ├─ Session recorder (asciinema .cast)                       │
│  ├─ MCP server (remote-shell tools)                          │
│  └─ AI bridge ──► Node sidecar (@cursor/sdk)                 │
└──────────────────────────────────────────────────────────────┘
```

## Tech stack

- **Shell:** Tauri 2
- **Backend:** Rust 1.80+, Tokio, russh, portable-pty, keyring
- **Frontend:** React 18, TypeScript 5, Vite 5, Tailwind 4, Radix UI, Zustand, xterm.js + WebGL addon, cmdk
- **AI:** `@cursor/sdk` (Node 22 sidecar), `@modelcontextprotocol/sdk`
- **Build:** code-signed installers, Tauri auto-updater

## Getting started

### Prerequisites

- Windows 10/11
- [Node.js 22 LTS](https://nodejs.org/)
- [Rust toolchain](https://rustup.rs/) (stable, MSVC)
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (required for Tauri on Windows)
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (preinstalled on Win 11)

### One-time setup

```powershell
npm run setup
```

This installs JS deps, installs the sidecar's deps, generates a placeholder app icon, and runs Tauri's icon generator. Replace `assets/icon.png` with your own 1024x1024 art any time and re-run `npm run icons`.

### Develop

```powershell
npm run tauri:dev
```

### Build a release

```powershell
npm run tauri build
```

Installer lands in `src-tauri/target/release/bundle/`.

## Signing in

The first time you open the AI sidebar, Aether prompts you to sign in:

- **Recommended — browser sign-in.** If the official `cursor-agent` CLI is on your PATH (one-click install offered inside Aether, or run `npm install -g cursor-agent`), Aether shells out to `cursor-agent login`. Cursor opens your default browser, you sign in with your email, and Aether copies the credential into your OS keyring.
- **Fallback — paste a key.** Without the CLI, Aether opens [`cursor.com/dashboard/integrations`](https://cursor.com/dashboard/integrations) for you. Generate a key there, paste it once, and Aether validates + stores it. You'll never see it again.
- **Power user — env var.** Set `CURSOR_API_KEY` and Aether picks it up implicitly.

In every mode, the secret is held in the OS keyring (DPAPI on Windows, Keychain on macOS, libsecret on Linux). It is never written to the Aether config file or to disk in plaintext. Sign out from the AI sidebar header pill or the command palette.

## Configuration

Aether reads `%APPDATA%\Aether\config.toml` on startup. See [`docs/CONFIG.md`](docs/CONFIG.md) for a full reference.

```toml
[appearance]
theme        = "midnight"
font_family  = "JetBrains Mono"
font_size    = 14
ligatures    = true
opacity      = 0.96

[ssh]
config_path  = "~/.ssh/config"
known_hosts  = "~/.ssh/known_hosts"
keepalive_s  = 30

[ai]
enabled      = true
model        = "composer-2"
api_key_env  = "CURSOR_API_KEY"
```

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md). Highlights:

- **Phase 1 — Foundation** PTY, SSH, tabs, themes
- **Phase 2 — SSH UX** ssh_config, vault, port forwards, SFTP, broadcast
- **Phase 3 — AI** Cursor sidecar, inline fixes, NL→command, MCP server
- **Phase 4 — Polish** themes, ligatures, sixel, code signing, auto-update

## Contributing

PRs welcome. Please read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) first.

## License

[MIT](LICENSE)
