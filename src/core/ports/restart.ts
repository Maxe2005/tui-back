// core/ports/restart: the clean-restart port contract. Group update runs a service's
// manifest-declared `restartCommands` recipe — one `run` per command, in order — when the
// run's clean-restart toggle calls for it, else the plain `ContainerPort.restart`. Core owns
// the loop and the stop-on-first-failure decision, never the adapter.
import type { Result } from '../result.js';

export interface RestartPort {
  // Runs one recipe command with repoPath as its working directory. A non-zero exit or
  // an unspawnable shell both surface as `restart-failed`, never a throw. Success carries
  // the command's trimmed stdout as `output`.
  run(repoPath: string, command: string): Promise<Result<{ output: string }>>;
}
