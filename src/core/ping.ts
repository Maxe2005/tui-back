// core/ping: a deliberately inert use-case, not an FR-mapped feature. It exists so one real
// subcommand proves the script/CLI-parity envelope end-to-end (the black-box test spawns it).
import { ok, type Result } from './result.js';

export async function ping(): Promise<Result<{ message: string }>> {
  return ok({ message: 'pong' });
}
