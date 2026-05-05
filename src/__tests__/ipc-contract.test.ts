import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "..", "..");
const LIB_RS = readFileSync(resolve(ROOT, "src-tauri", "src", "lib.rs"), "utf-8");
const IPC_TS = readFileSync(resolve(ROOT, "src", "lib", "ipc.ts"), "utf-8");
const COMMANDS_RS = readFileSync(
  resolve(ROOT, "src-tauri", "src", "commands.rs"),
  "utf-8"
);

/** Extract every command name listed inside `tauri::generate_handler![...]`. */
function backendCommands(): string[] {
  const start = LIB_RS.indexOf("invoke_handler(tauri::generate_handler!");
  if (start < 0) return [];
  const open = LIB_RS.indexOf("[", start);
  const close = LIB_RS.indexOf("]", open);
  const block = LIB_RS.slice(open + 1, close);
  return block
    .split(",")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/.*::/, ""));
}

/** Extract every `invoke("command_name", ...)` call site in ipc.ts. */
function frontendInvokes(): string[] {
  const re = /\binvoke(?:<[^>]*>)?\s*\(\s*"([^"]+)"/g;
  const out = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(IPC_TS)) !== null) out.add(m[1]!);
  return Array.from(out);
}

describe("IPC contract", () => {
  const backend = backendCommands();
  const frontend = frontendInvokes();

  it("the parser found commands", () => {
    expect(backend.length).toBeGreaterThan(5);
    expect(frontend.length).toBeGreaterThan(5);
  });

  it("every backend command is wrapped by the frontend", () => {
    const missing = backend.filter((c) => !frontend.includes(c));
    expect(missing, `backend commands missing a frontend wrapper: ${missing.join(", ")}`).toEqual([]);
  });

  it("every frontend invoke targets a real backend command", () => {
    const orphans = frontend.filter((c) => !backend.includes(c));
    expect(orphans, `frontend calls referencing nonexistent commands: ${orphans.join(", ")}`).toEqual([]);
  });

  it("every backend command has a #[tauri::command] definition", () => {
    const missing = backend.filter(
      (c) => !new RegExp(`pub\\s+(?:async\\s+)?fn\\s+${c}\\s*\\(`).test(COMMANDS_RS)
    );
    expect(missing, `commands listed in lib.rs but not implemented in commands.rs: ${missing.join(", ")}`).toEqual([]);
  });
});
