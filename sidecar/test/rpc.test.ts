import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub @cursor/sdk so we don't reach out to the network or require an API key
// for these dispatch-level tests. Vitest hoists vi.mock to the top of the
// module, so we can assert on the stubs from inside each test.
const dispose = vi.fn(async () => {});
const wait = vi.fn(async () => ({ status: "completed", result: "ok" }));
const send = vi.fn(async () => ({ id: "run-1", wait }));
const create = vi.fn(async (opts: { apiKey?: string }) => ({
  agentId: `agent-${opts.apiKey ?? "anon"}`,
  send,
  [Symbol.asyncDispose]: dispose,
}));

vi.mock("@cursor/sdk", () => ({
  Agent: { create },
  CursorAgentError: class CursorAgentError extends Error {
    isRetryable: boolean;
    constructor(msg: string, opts?: { isRetryable?: boolean }) {
      super(msg);
      this.isRetryable = opts?.isRetryable ?? false;
    }
  },
}));

const { handleRequest } = await import("../src/rpc.js");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rpc dispatcher", () => {
  it("returns null for non-request payloads", async () => {
    expect(await handleRequest(null)).toBeNull();
    expect(await handleRequest({})).toBeNull();
    expect(await handleRequest({ method: "ping" })).toBeNull();
    expect(await handleRequest({ id: 1 })).toBeNull();
  });

  it("responds to ping with a pong + monotonic timestamp", async () => {
    const reply = (await handleRequest({ id: 1, method: "ping" }))!;
    expect(reply.id).toBe(1);
    expect(reply.result).toMatchObject({ pong: true });
    expect(typeof (reply.result as { ts: number }).ts).toBe("number");
  });

  it("rejects unknown methods with code -32601", async () => {
    const reply = (await handleRequest({
      id: "x",
      method: "totally.unknown",
    }))!;
    expect(reply.id).toBe("x");
    expect(reply.error?.code).toBe(-32601);
  });

  it("agent.create demands an api key", async () => {
    delete process.env.CURSOR_API_KEY;
    const reply = (await handleRequest({
      id: 7,
      method: "agent.create",
      params: {},
    }))!;
    expect(reply.error).toBeTruthy();
    expect(reply.error?.message).toMatch(/CURSOR_API_KEY/);
  });

  it("agent.create with apiKey forwards to the SDK and returns agentId", async () => {
    const reply = (await handleRequest({
      id: 8,
      method: "agent.create",
      params: { apiKey: "test-key", model: "composer-2" },
    }))!;
    expect(reply.error).toBeUndefined();
    expect(reply.result).toEqual({ agentId: "agent-test-key" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]![0]).toMatchObject({
      apiKey: "test-key",
      model: { id: "composer-2" },
    });
  });

  it("agent.send is rejected when the agent id is unknown", async () => {
    const reply = (await handleRequest({
      id: 9,
      method: "agent.send",
      params: { agentId: "no-such", prompt: "hi" },
    }))!;
    expect(reply.error?.code).toBe(404);
  });

  it("agent.send returns the SDK status + result", async () => {
    const created = (await handleRequest({
      id: 10,
      method: "agent.create",
      params: { apiKey: "k" },
    }))!;
    const agentId = (created.result as { agentId: string }).agentId;
    const reply = (await handleRequest({
      id: 11,
      method: "agent.send",
      params: { agentId, prompt: "hello" },
    }))!;
    expect(reply.result).toMatchObject({
      runId: "run-1",
      status: "completed",
      result: "ok",
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it("agent.dispose succeeds even when the agent is already gone", async () => {
    const reply = (await handleRequest({
      id: 12,
      method: "agent.dispose",
      params: { agentId: "ghost" },
    }))!;
    expect(reply.result).toEqual({ ok: true });
  });

  it("CursorAgentError is surfaced as a structured rpc error", async () => {
    create.mockRejectedValueOnce(
      new (await import("@cursor/sdk")).CursorAgentError("auth failed", {
        isRetryable: false,
      })
    );
    const reply = (await handleRequest({
      id: 13,
      method: "agent.create",
      params: { apiKey: "bad" },
    }))!;
    expect(reply.error).toBeTruthy();
    expect(reply.error?.message).toBe("auth failed");
    expect((reply.error?.data as { retryable: boolean }).retryable).toBe(false);
  });
});
