// core/ports/manifest: the Manifest model and the port the driven manifest adapter
// implements (AD-1). Core use-cases consume a Manifest without ever importing the
// adapter; the adapter's loader turns a repo's root .tui-back.yaml into this shape.
import type { Result } from '../result.js';

export interface Manifest {
  service: string;
  container: string;
  migrationCommand?: string;
  restartCommands?: string[];
  sharedBranch: string;
  modules: Record<string, Record<string, unknown>>;
}

export interface ManifestPort {
  load(repoPath: string): Promise<Result<Manifest>>;
}
