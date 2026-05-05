import { createInterface } from "node:readline";
import process from "node:process";

import { handleRequest } from "./rpc.js";
import { logger } from "./logger.js";

logger.info({ pid: process.pid }, "aether sidecar starting");

const rl = createInterface({ input: process.stdin });

rl.on("line", async (line) => {
  if (!line.trim()) return;
  let payload: unknown;
  try {
    payload = JSON.parse(line);
  } catch (err) {
    logger.error({ err, line }, "invalid JSON-RPC frame");
    return;
  }
  const reply = await handleRequest(payload);
  if (reply) {
    process.stdout.write(JSON.stringify(reply) + "\n");
  }
});

process.on("SIGINT", () => {
  logger.info("sidecar SIGINT, shutting down");
  process.exit(0);
});
