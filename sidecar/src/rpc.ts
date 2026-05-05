import { Agent, CursorAgentError, type SDKAgent } from "@cursor/sdk";

import { logger } from "./logger.js";

type AgentInstance = SDKAgent;

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
        if (!agent)
          return fail(payload.id, 404, `unknown agent: ${agentId}`);
        const run = await agent.send(prompt);
        const final = await run.wait();
        return ok(payload.id, {
          runId: run.id,
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
    return fail(payload.id, 500, summarise("rpc handler error", detail), {
      detail,
    });
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
