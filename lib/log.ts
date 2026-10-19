import "server-only";

export type LogLevel = "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

// Field names whose values must never reach the logs, at any depth.
const SECRET_KEY = /token|secret|password|authorization|cookie|api[_-]?key|credential/i;
const MAX_STRING = 500;
const MAX_DEPTH = 4;

function clean(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return clean(errorFields(value), depth);
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => clean(item, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, SECRET_KEY.test(key) ? "[redacted]" : clean(item, depth + 1)]));
}

/** The safe, loggable parts of an error: its name, message, and any code, status or digest. */
export function errorFields(error: unknown): LogFields {
  if (!(error instanceof Error)) return { error: typeof error === "string" ? error : "Non-error value thrown" };
  const extra = error as Error & { code?: unknown; status?: unknown; digest?: unknown };
  return {
    error: error.name,
    message: error.message,
    ...(extra.code !== undefined ? { code: extra.code } : {}),
    ...(extra.status !== undefined ? { status: extra.status } : {}),
    ...(extra.digest !== undefined ? { digest: extra.digest } : {}),
  };
}

/**
 * Writes one JSON line per event, which Vercel's runtime logs store and can
 * filter by level, event or any field. Secret-looking fields are redacted and
 * long strings are cut; never pass request bodies, tokens or AI prompts.
 */
export function log(level: LogLevel, event: string, fields: LogFields = {}) {
  const line = JSON.stringify({ level, event, time: new Date().toISOString(), ...(clean(fields, 0) as LogFields) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.info(line);
}
