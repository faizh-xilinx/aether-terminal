import { Agent, CursorAgentError, type SDKAgent } from "@cursor/sdk";

import { logger } from "./logger.js";

type AgentInstance = SDKAgent;

/**
 * Push a non-RPC event to the parent on stdout. The Rust side's reader
 * looks for the `event` field and re-emits it as a Tauri event named
 * `ai:<kind>` carrying this payload, so the frontend can `listen` for it.
 */
function emitEvent(kind: string, payload: Record<string, unknown>): void {
  const frame = JSON.stringify({ event: kind, payload });
  process.stdout.write(frame + "\n");
}

/**
 * Translate one element of the SDK's streamed event sequence into the
 * minimal shape the UI needs. The SDK exposes a wide event taxonomy
 * (text, thinking, tool_use, tool_result, system, etc.); we focus on
 * the ones a chat-style UI actually renders. Extra event types fall
 * through silently rather than spamming the renderer.
 */
function forwardStreamEvent(runId: string, event: unknown): void {
  if (!event || typeof event !== "object") return;
  const ev = event as Record<string, unknown>;
  const type = typeof ev.type === "string" ? ev.type : "";

  if (type === "assistant") {
    const message = ev.message as { content?: unknown } | undefined;
    const blocks = Array.isArray(message?.content) ? message.content : [];
    for (const block of blocks) {
      if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "text"
      ) {
        const text = (block as { text?: string }).text;
        if (typeof text === "string" && text.length > 0) {
          emitEvent("ai:text", { runId, text });
        }
      } else if (
        block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_use"
      ) {
        const name = (block as { name?: string }).name ?? "tool";
        emitEvent("ai:tool", { runId, name });
      }
    }
  } else if (type === "thinking") {
    const message = ev.message as { text?: string } | undefined;
    if (message?.text) emitEvent("ai:thinking", { runId, text: message.text });
  } else if (type === "tool_use") {
    const name = (ev as { name?: string }).name ?? "tool";
    emitEvent("ai:tool", { runId, name });
  } else if (type === "result") {
    // Final aggregate sent by some SDK versions; we already get this via
    // run.wait() so suppress to avoid double-rendering.
  }
}

interface RpcRequest {
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface RpcResponse {
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const agents = new Map<string, AgentInstance>();

function ok(id: RpcRequest["id"], result: unknown): RpcResponse {
  return { id, result };
}

function fail(
  id: RpcRequest["id"],
  code: number,
  message: string,
  data?: unknown
): RpcResponse {
  return { id, error: { code, message, data } };
}

export async function handleRequest(payload: unknown): Promise<RpcResponse | null> {
  if (!isRequest(payload)) return null;

  try {
    switch (payload.method) {
      case "ping":
        return ok(payload.id, { pong: true, ts: Date.now() });

      case "agent.create": {
        const apiKey = readApiKey(payload.params);
        const cwd = (payload.params?.cwd as string | undefined) ?? process.cwd();
        const model =
          (payload.params?.model as string | undefined) ?? "composer-2";
        const agent = await Agent.create({
          apiKey,
          model: { id: model },
          local: { cwd, settingSources: [] },
        });
        agents.set(agent.agentId, agent);
        logger.info({ agentId: agent.agentId, cwd, model }, "agent created");
        return ok(payload.id, { agentId: agent.agentId });
      }

      case "agent.send": {
        const agentId = String(payload.params?.agentId ?? "");
        const prompt = String(payload.params?.prompt ?? "");
        const agent = agents.get(agentId);
        if (!agent) return fail(payload.id, 404, `unknown agent: ${agentId}`);

        const run = await agent.send(prompt);
        const runId = run.id;

        // Tell the parent the run started so the UI can show its placeholder.
        emitEvent("ai:run-start", { runId });

        // Drain the event stream concurrently so text and tool-call updates
        // reach the user as soon as the model emits them, instead of after
        // the whole agent loop finishes. Errors here are reported via an
        // ai:error event but don't abort the run — `run.wait()` is still
        // the source of truth for the final result.
        const streamTask = (async () => {
          if (!run.supports("stream")) return;
          try {
            for await (const event of run.stream()) {
              forwardStreamEvent(runId, event);
            }
          } catch (err) {
            emitEvent("ai:error", {
              runId,
              message: err instanceof Error ? err.message : String(err),
            });
          }
        })();

        const final = await run.wait();
        await streamTask.catch(() => {});

        emitEvent("ai:run-end", {
          runId,
          status: final.status,
          result: final.result,
        });

        return ok(payload.id, {
          runId,
          status: final.status,
          result: final.result,
        });
      }

      case "agent.dispose": {
        const agentId = String(payload.params?.agentId ?? "");
        const agent = agents.get(agentId);
        if (agent) {
          await agent[Symbol.asyncDispose]();
          agents.delete(agentId);
        }
        return ok(payload.id, { ok: true });
      }

      default:
        return fail(payload.id, -32601, `unknown method: ${payload.method}`);
    }
  } catch (err) {
    // Surface as much detail as the SDK gave us. Cursor's CursorAgentError
    // sometimes wraps an underlying transport / auth failure whose real
    // message lives in `cause`, `data`, or the stack trace, not the
    // top-level `message`.
    const cause =
      err && typeof err === "object" && "cause" in err
        ? (err as { cause?: unknown }).cause
        : undefined;
    const detail =
      err instanceof Error
        ? [err.message, cause ? String(cause) : "", err.stack ?? ""]
            .filter(Boolean)
            .join(" | ")
        : String(err);

    if (err instanceof CursorAgentError) {
      logger.error(
        {
          err: err.message,
          retryable: err.isRetryable,
          cause: cause ? String(cause) : undefined,
          stack: err.stack,
        },
        "Cursor SDK error"
      );
      return fail(payload.id, 500, summarise(err.message, detail), {
        retryable: err.isRetryable,
        detail,
      });
    }
    logger.error({ err: detail }, "rpc handler error");
    const top = err instanceof Error ? err.message : String(err);
    return fail(payload.id, 500, summarise(top, detail), { detail });
  }
}

/**
 * Pick the most useful sentence available in an error chain. SDK errors with
 * a generic `.message === "Error"` are common when the real cause is buried
 * one level down; prefer the first non-trivial line.
 */
function summarise(top: string, detail: string): string {
  const trimmed = (top ?? "").trim();
  if (trimmed && trimmed.toLowerCase() !== "error" && trimmed !== "[object Object]") {
    return trimmed;
  }
  const lines = detail
    .split(/\||\n/)
    .map((s) => s.trim())
    .filter((s) => s && s.toLowerCase() !== "error" && !s.startsWith("at "));
  return lines[0] ?? trimmed ?? "unknown error";
}

function isRequest(p: unknown): p is RpcRequest {
  return (
    typeof p === "object" &&
    p !== null &&
    "id" in p &&
    "method" in p &&
    typeof (p as RpcRequest).method === "string"
  );
}

function readApiKey(params?: Record<string, unknown>): string {
  const fromParams = params?.apiKey;
  if (typeof fromParams === "string" && fromParams.length > 0) return fromParams;
  const fromEnv = process.env.CURSOR_API_KEY;
  if (fromEnv && fromEnv.length > 0) return fromEnv;
  throw new Error(
    "CURSOR_API_KEY not set; pass apiKey in params or set the env var"
  );
}
