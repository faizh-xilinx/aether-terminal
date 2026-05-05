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
    if (err instanceof CursorAgentError) {
      logger.error({ err: err.message, retryable: err.isRetryable }, "Cursor SDK error");
      return fail(payload.id, 500, err.message, { retryable: err.isRetryable });
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, "rpc handler error");
    return fail(payload.id, 500, msg);
  }
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
