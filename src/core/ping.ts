// core/ping: a deliberately inert use-case. It is NOT an FR-mapped feature — no FR names a
// CLI self-check. It exists only so this story ships one real, shipped subcommand to prove
// the AD-2/AD-3 script/CLI-parity contract end-to-end (the black-box test needs a real
// subcommand to invoke as a child process). Story 1.5's register/list-repos is the first
// real Must-scope action; don't mistake this for that.
import { ok, type Result } from './result.js';

export async function ping(): Promise<Result<{ message: string }>> {
  return ok({ message: 'pong' });
}
