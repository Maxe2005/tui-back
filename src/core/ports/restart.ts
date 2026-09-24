// core/ports/restart: the clean-restart port contract (story 3.8). Group update runs
// each member service's manifest-declared `restartCommands` recipe — one `run` per
// declared command, in order, stopping on the first failure — when the run's clean-restart
// toggle calls for it; without a declared recipe it falls back to today's plain
// `ContainerPort.restart`. Shaped exactly like `MigrationPort` (repoPath + one command in,
// output/failure out); core owns the loop and the stop-on-first-failure decision, never
// the adapter. Core consumes the contract without ever importing the adapter (AD-1).
import type { Result } from '../result.js';

export interface RestartPort {
  // Runs one recipe command with repoPath as its working directory. A non-zero exit or
  // an unspawnable shell both surface as `restart-failed`, never a throw. Success carries
  // the command's trimmed stdout as `output`.
  run(repoPath: string, command: string): Promise<Result<{ output: string }>>;
}
