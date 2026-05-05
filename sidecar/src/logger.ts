type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, fields: Record<string, unknown> | string, msg?: string) {
  const obj =
    typeof fields === "string"
      ? { level, msg: fields }
      : { level, msg: msg ?? "", ...fields };
  process.stderr.write(JSON.stringify(obj) + "\n");
}

export const logger = {
  debug: (f: Record<string, unknown> | string, msg?: string) => emit("debug", f, msg),
  info: (f: Record<string, unknown> | string, msg?: string) => emit("info", f, msg),
  warn: (f: Record<string, unknown> | string, msg?: string) => emit("warn", f, msg),
  error: (f: Record<string, unknown> | string, msg?: string) => emit("error", f, msg),
};
