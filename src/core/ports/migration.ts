// core/ports/migration: the migration port contract. Group update runs each member service's
// manifest-declared `migrationCommand` after its pull/merge and before its container restart;
// the driven adapter owns how the command is spawned.
import type { Result } from '../result.js';

export interface MigrationPort {
  // Runs the manifest-declared migration command with repoPath as its working directory.
  // A non-zero exit or an unspawnable shell both surface as `migration-failed`, never a
  // throw. Success carries the command's trimmed stdout as `output`.
  run(repoPath: string, command: string): Promise<Result<{ output: string }>>;
}
