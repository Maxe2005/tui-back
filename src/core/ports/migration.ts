// core/ports/migration: the migration port contract (story 3.2). Group update runs each
// member service's manifest-declared `migrationCommand` after its pull/merge and before
// its container restart; the driven adapter owns how that command is executed
// (non-interactive child_process spawn with captured stdout/stderr). Core consumes the
// contract without ever importing the adapter (AD-1).
import type { Result } from '../result.js';

export interface MigrationPort {
  // Runs the manifest-declared migration command with repoPath as its working directory.
  // A non-zero exit or an unspawnable shell both surface as `migration-failed`, never a
  // throw. Success carries the command's trimmed stdout as `output`.
  run(repoPath: string, command: string): Promise<Result<{ output: string }>>;
}
