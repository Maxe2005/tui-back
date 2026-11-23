// core/edt/switch/types: public and shared types of the EDT switch (results, dirty-work
// resolutions, params, per-repo context) plus the `failed` row builder. Leaf module: imports
// nothing from the rest of the switch, so dirty.ts / member.ts / switch.ts never form a cycle.
import type { EdtMember, EdtRegistryEntry, EdtRegistryPort } from '../../ports/storage/edt-registry.js';
import type { GitPort } from '../../ports/vcs/git.js';
import type { LockPort } from '../../ports/runtime/lock.js';
import type { ManifestCarryPort } from '../../ports/vcs/manifest-carry.js';
import type { ManifestPort } from '../../ports/vcs/manifest.js';
import type { RegistryPort } from '../../ports/storage/registry.js';
import type { StatePort } from '../../ports/storage/state.js';
import type { ResultError } from '../../result.js';

export interface SwitchEdtRepoResult {
  service: string;
  outcome: 'switched' | 'adopted' | 'discarded' | 'unchanged' | 'failed';
  // `discardedPaths`: on a `discarded` row, exactly the paths the discard removed (captured
  // before `discardAll`, untracked directories expanded to files).
  // `adoptedBranch`: on an `adopted` row, the branch the work was adopted onto in the
  // outgoing EDT (the TUI's action log records it).
  detail?: { code: string; message: string; discardedPaths?: string[]; adoptedBranch?: string };
}

// A caller's explicit decision for one dirty state-2/3 repo. `confirmedPaths`: the exact paths
// the user confirmed destroying (the TUI's discard confirmation, from the pre-flight
// `dirtyPaths` snapshot). When set, the discard refuses — `failed` row
// `switch-discard-paths-changed`, repo untouched — if its fresh capture holds any path outside
// it (a file changed while the dialog was open). The CLI never sets it.
export type DirtyResolution = { kind: 'adopt'; branch: string } | { kind: 'discard'; confirmedPaths?: string[] };

// the CLI's flag-driven sugar. It is expanded into per-repo `DirtyResolution`s AFTER
// the pre-flight classification (the CLI never classifies repos itself): `discard` discards every
// dirty state-2/3 repo; `adopt` adopts each onto `branch` when it sits on a shared branch, or
// keeping its current (non-shared) branch otherwise — `branch` may then be omitted, but a dirty
// shared-branch repo with no `branch` fails up front with `missing-argument`.
export type DirtyPolicy = { kind: 'adopt'; branch?: string } | { kind: 'discard' };

export type SwitchDirtyScope = 'outgoing-member' | 'member-of-other-edt' | 'non-member';

// One row per dirty registered repo, computed before any git write. State-1 rows
// (`outgoing-member`) carry `resolution: 'auto-stash'` — read-only information, they need no
// decision. State-2/3 rows are the ones a resolution is required for; `owningEdtTopics` lists
// the other EDTs claiming the repo (empty for a non-member).
// `sharedBranch` (null when the manifest could not be loaded) and `protectedBranches` (empty
// when none or unloadable) form the repo's FR-7 protected set for the TUI's advisory check.
// `dirtyPaths` (state-2/3 rows only) is a read-only expanded snapshot the TUI's discard
// confirmation lists; a failed read leaves it unset.
export interface SwitchDirtyRepo {
  service: string;
  repoPath: string;
  scope: SwitchDirtyScope;
  currentBranch: string;
  currentBranchShared: boolean;
  sharedBranch: string | null;
  protectedBranches: string[];
  owningEdtTopics: string[];
  dirtyPaths?: string[];
  resolution?: 'auto-stash';
  // True when the repo also has a dirty `.tui-back.yaml`: it is carried over untouched, outside
  // any resolution, and never listed in `dirtyPaths`.
  manifestCarried?: boolean;
  // True when the outgoing EDT is the system "Shared branches" EDT: "adopt into the outgoing
  // EDT" is unavailable (stash or discard only) — the dialog hides the choice and says why.
  adoptUnavailable?: boolean;
}

export type SwitchDirtyReposChoice =
  | { kind: 'cancel' }
  | { kind: 'proceed'; resolutions: Record<string, DirtyResolution> };

export type OnDirtyReposBeforeSwitch = (dirty: SwitchDirtyRepo[]) => Promise<SwitchDirtyReposChoice>;

// The `details` of a `switch-dirty-services-unresolved` error: one entry per blocking repo.
export interface SwitchUnresolvedDirtyRepo {
  service: string;
  repoPath: string;
  scope: 'member-of-other-edt' | 'non-member';
  currentBranch: string;
}

export interface SwitchActiveEdtData {
  ulid: string;
  topic: string;
  results: SwitchEdtRepoResult[];
  // True when the target EDT's registry entry carried status 'interrupted' coming into this
  // switch (i.e. it was last left via a --force switch past its own held lock) — read before
  // this call flips it back to 'active'.
  wasInterrupted: boolean;
}

export interface SwitchActiveEdtParams {
  edtRegistry: EdtRegistryPort;
  registry: RegistryPort;
  manifest: ManifestPort;
  manifestCarry: ManifestCarryPort;
  git: GitPort;
  lock: LockPort;
  state: StatePort;
  // Same resource key create.ts's registry writes lock under (AD-9) — this use-case writes
  // edts.yaml too.
  edtRegistryResourceKey: string;
  topic: string;
  force?: boolean;
  // Explicit per-repo resolutions keyed by repoPath (the CLI path). When supplied, the seam
  // below is never invoked.
  dirtyResolutions?: Record<string, DirtyResolution>;
  // policy sugar for the CLI flags; an explicit `dirtyResolutions` entry for a repo
  // wins over the policy. When supplied (like dirtyResolutions), the seam is never invoked.
  dirtyPolicy?: DirtyPolicy;
    // The TUI's resolution seam — see switchActiveEdt.
  onDirtyReposBeforeSwitch?: OnDirtyReposBeforeSwitch;
}

export type SwitchRepoState = 1 | 2 | 3;

export interface ClassifiedSwitchRepo {
  repoPath: string;
  state: SwitchRepoState;
  // Set when the repo is a member of the TARGET (decides the destination branch).
  targetMember?: EdtMember;
  // Topics of every EDT other than the outgoing one that lists this repo as a member.
  owningTopics: string[];
}

export interface RepoSwitchContext {
  git: GitPort;
  manifest: ManifestPort;
  manifestCarry: ManifestCarryPort;
  edtRegistry: EdtRegistryPort;
  lock: LockPort;
  edtRegistryResourceKey: string;
  outgoing: EdtRegistryEntry | undefined;
  target: EdtRegistryEntry;
}

// Exported for activate.ts, which reports its per-repo rows the same way.
export function failed(service: string, error: ResultError): SwitchEdtRepoResult {
  return { service, outcome: 'failed', detail: { code: error.code, message: error.message } };
}
