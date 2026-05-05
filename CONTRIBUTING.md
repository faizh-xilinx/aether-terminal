# Contributing to Aether

Thanks for considering a contribution. Aether is in early alpha, so the surface area is still moving — small, focused PRs are easiest to review.

## Workflow

1. Fork → branch → PR.
2. One concept per PR. If you find yourself writing "and also" in the description, split it.
3. Add or update tests when behaviour changes.
4. `npm run typecheck`, `npm run lint`, and `cargo clippy --all-targets -- -D warnings` must be clean.

## Local setup

See [README — One-time setup](./README.md#one-time-setup).

## Code style

- **Rust:** `rustfmt` (default), `clippy::all` clean. Prefer small modules, `Result` over panics, no `unsafe` outside FFI we already depend on.
- **TypeScript:** ES2022, no `any` without a comment justifying it, Tailwind utility classes ordered logically (layout → spacing → color → typography).
- **Comments:** explain *why*, not *what*. The code says what.

## Where things live

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

## Filing issues

Please include:
- Aether version (`aether --version` or About panel)
- OS + WebView2 version
- Reproducible steps (smallest sequence that triggers it)
- Whether AI features are involved (sidecar logs at `%APPDATA%\Aether\logs\sidecar.log`)
