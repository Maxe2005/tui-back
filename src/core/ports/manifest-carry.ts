// core/ports/manifest-carry: captures a repo's .tui-back.yaml exactly as it is on disk and
// writes it back later, so an EDT switch can leave it untouched whatever the target branch holds.
import type { Result } from '../result.js';

export type ManifestSnapshot = { kind: 'present'; content: Uint8Array } | { kind: 'absent' };

export interface ManifestCarryPort {
  // Reads the manifest bytes (or notes its absence) and keeps a safety copy next to the repo's
  // git data until `restore` succeeds, so a crash mid-switch never loses the only copy.
  capture(repoPath: string): Promise<Result<ManifestSnapshot>>;
  // Writes the snapshot back (deleting the file when it was absent) and drops the safety copy.
  // On failure the copy is kept and the error message names its path.
  restore(repoPath: string, snapshot: ManifestSnapshot): Promise<Result<void>>;
}
