// core/result: the {ok,data}/{ok,error} envelope every core use-case returns (AD-3).
// The CLI adapter serializes this to stdout; the TUI adapter consumes the same object
// directly (AD-2) — the shape below is identical on both paths.

// Files using this generic union must keep their imports as their first statements:
// dependency-cruiser's acorn fallback otherwise silently drops those imports from the graph
// (locked in by dependency-cruiser.config.test.ts).

export interface ResultError {
  code: string;
  message: string;
  details?: unknown;
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ResultError };

export function ok<T>(data: T): Result<T> {
  return { ok: true, data };
}

/**
 * error.code is a kebab-case string (e.g. "unknown-subcommand", "internal-error") — the
 * convention every use-case's error codes follow.
 */
export function err(code: string, message: string, details?: unknown): Result<never> {
  return { ok: false, error: details === undefined ? { code, message } : { code, message, details } };
}
