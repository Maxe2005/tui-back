// core/ports/manifest: the Manifest model and the port the driven manifest adapter
// implements (AD-1). Core use-cases consume a Manifest without ever importing the
// adapter; the adapter's loader turns a repo's root .tui-back.yaml into this shape.
import type { Result } from '../result.js';

export interface Manifest {
  service: string;
  container?: string;
  // Optional http(s) URL — the steady-state status probe: core/service-status probes it first
  // and combines the answer with the container state (AD-23), for every displayed status and
  // for each post-restart verification attempt. A container-less service declaring it gets a
  // real up/down. Absent = the raw container state, with `up` unverified.
  healthUrl?: string;
  migrationCommand?: string;
  restartCommands?: string[];
  sharedBranch: string;
  // The service's own protected branches (FR-7). The effective protected set is
  // exactly `protectedBranches ∪ {sharedBranch}` — nothing is protected implicitly.
  protectedBranches?: string[];
  modules: Record<string, Record<string, unknown>>;
}

export interface ManifestPort {
  load(repoPath: string): Promise<Result<Manifest>>;
}
