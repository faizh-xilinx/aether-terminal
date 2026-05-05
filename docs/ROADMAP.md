# Roadmap

## Phase 1 — Foundation
- [x] Tauri 2 + React + TS scaffolding
- [x] xterm.js with WebGL renderer
- [x] Local PTY sessions via portable-pty
- [x] SSH sessions via russh (key + password auth)
- [x] Tab bar with new/close
- [x] Theme system + 4 default themes
- [x] Command palette (cmdk)
- [x] Quick-connect dialog reading `~/.ssh/config`
- [x] Custom title bar (frameless window)

## Phase 2 — SSH UX
- [ ] Known hosts (TOFU) verification flow
- [ ] SSH agent auth (Pageant / OpenSSH-Agent / 1Password)
- [ ] Port forwarding UI
- [ ] SFTP browser (split view per host)
- [ ] Broadcast input across panes
- [ ] Auto-reconnect with exponential backoff
- [ ] Session recording (asciinema `.cast`)
- [ ] Split panes (horizontal / vertical / grid)
- [ ] Vault UI for credentials

## Phase 3 — AI
- [x] Sidecar with `@cursor/sdk` and JSON-RPC
- [ ] Wire sidecar to Rust + renderer events
- [ ] AI sidebar with streaming output
- [ ] Inline "Fix with AI" chip on non-zero exit codes
- [ ] Natural-language → command (with confirmation gate)
- [ ] Custom MCP server: `run_remote`, `read_remote_file`, `tail_log`
- [ ] Session summary command (Markdown export)
- [ ] AI rate-limiting + cost preview

## Phase 4 — Polish
- [ ] Settings UI (TOML round-trip)
- [ ] Sixel & iTerm2 inline images
- [ ] Ligatures & font picker
- [ ] Optional CRT shader
- [ ] Workspaces (saved tab groups)
- [ ] Tauri auto-updater
- [ ] Code-signed installers (NSIS + MSI)
- [ ] Crash reporting (sentry-rust, opt-in)
- [ ] Telemetry (opt-in)

## Phase 5 — macOS / Linux
- [ ] macOS bundle (codesign + notarize)
- [ ] Linux bundles (AppImage, deb, rpm)
- [ ] Per-platform PTY/keychain shims tested

## Phase 6 — Power user / pro
- [ ] Multi-cursor / vim mode in input line
- [ ] tmux/zellij protocol bridge
- [ ] Mosh integration for resilient SSH
- [ ] Plugin SDK (TypeScript-first)
