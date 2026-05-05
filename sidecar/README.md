# Aether Sidecar

A small Node 20+ process spawned by the Aether Rust backend. It hosts the [`@cursor/sdk`](https://cursor.com/docs/api/sdk/typescript) and exposes a JSON-RPC interface over stdio.

## Why a sidecar?

- The Cursor SDK is TypeScript-only.
- Keeping the agent runtime out-of-process means a misbehaving agent (hung tool call, OOM, infinite loop) cannot crash the terminal.
- Crisp lifecycle: the Rust process owns the sidecar lifetime, can replace it, sandbox it, or upgrade it independently.

## Protocol

Newline-delimited JSON-RPC over stdin/stdout. stderr is reserved for structured logs.

### Methods

| method | params | result |
|---|---|---|
| `ping` | – | `{ pong: true, ts }` |
| `agent.create` | `{ apiKey?, cwd?, model? }` | `{ agentId }` |
| `agent.send` | `{ agentId, prompt }` | `{ runId, status, result }` |
| `agent.dispose` | `{ agentId }` | `{ ok: true }` |

Streaming (`run.stream()`) will be added once we wire it through events on the Rust side.

## Auth

`CURSOR_API_KEY` is read from the environment (or passed inline). See [Cursor SDK auth docs](https://cursor.com/docs/api/sdk/typescript#auth-minimum-viable).

## Run standalone (for debugging)

```bash
npm install
echo '{"id":1,"method":"ping"}' | npm run dev
```
