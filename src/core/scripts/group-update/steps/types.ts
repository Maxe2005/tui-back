// core/scripts/group-update/types: public types of the group update: params, rows, selection, blocker seam and phase observers.
import type { ContainerPort } from "../../../ports/container.js";
import type { EdtRegistryPort } from "../../../ports/edt-registry.js";
import type { GitPort } from "../../../ports/git.js";
import type { LockPort } from "../../../ports/lock.js";
import type { ManifestPort } from "../../../ports/manifest.js";
import type { MigrationPort } from "../../../ports/migration.js";
import type { RegistryPort } from "../../../ports/registry.js";
import type { RestartPort } from "../../../ports/restart.js";
import type { StatePort } from "../../../ports/state.js";
import { type StageControl } from "../../update-support/run-pool.js";
import { failed, skipped } from "./outcome.js";
import { outputExcerpt } from "./member.js";

// What the pull/merge and migrate phases did for one service — best-effort, only on the rows
// that completed them.
export interface GroupUpdateRunDetail {
  merge:
    | { kind: "up-to-date" }
    | {
        kind: "advanced";
        files?: number;
        insertions?: number;
        deletions?: number;
      };
  migrations:
    { kind: "none" } | { kind: "ran"; command: string; outputExcerpt: string };
  // Only on a row whose merge conflicted and an auto-resolver ran: `auto-resolved` (settled
  // with no menu), `partial` (settled in part, the rest left to the developer), `left-to-user`
  // (the resolver could not settle its part).
  conflict?: "auto-resolved" | "partial" | "left-to-user";
}

export interface GroupUpdateRepoResult {
  service: string;
  outcome: "updated" | "skipped" | "failed";
  detail?: { code: string; message: string };
  run?: Partial<GroupUpdateRunDetail>;
}

export interface GroupUpdateData {
  ulid: string;
  topic: string;
  results: GroupUpdateRepoResult[];
  // Set only for the zero-member no-op — an explicit no-op message, never silent success.
  note?: string;
  scope: "edt" | "all";
}

export type GroupUpdateScope = "edt" | "all";

// One pre-run configuration row. `repoPath` disambiguates duplicate service
// names (the EDT dedupe precedent); `sourceBranch` overrides the manifest `sharedBranch`
// as this service's merge source (blank/undefined falls back to `sharedBranch`).
export interface GroupUpdateSelectionItem {
  service: string;
  repoPath?: string;
  sourceBranch?: string;
  // Per-service overrides of the run-wide toggles; undefined follows the run-wide value.
  runMigrations?: boolean;
  cleanRestart?: boolean;
}

export interface GroupUpdateParams {
  edtRegistry: EdtRegistryPort;
  state: StatePort;
  manifest: ManifestPort;
  git: GitPort;
  container: ContainerPort;
  migration: MigrationPort;
  restart: RestartPort;
  lock: LockPort;
  registry?: RegistryPort;
  scope?: GroupUpdateScope;
  // The pre-run configuration. `selection` filters the enumerated targets down to exactly the
  // confirmed set — a deselected service is excluded entirely (never touched, never
  // reported). Undefined means every enumerated target; an empty array is an explicit
  // `no-services-selected` rejection before any lock is taken. `runMigrations` defaults to
  // true; `cleanRestart` defaults to false — on, it runs the manifest's `restartCommands`
  // recipe in order when declared, falling back to the plain container restart.
  selection?: GroupUpdateSelectionItem[];
  runMigrations?: boolean;
  cleanRestart?: boolean;
  // The assisted-resolution seam. Absent on the CLI path (dirty/conflict repos are skipped or
  // aborted); the TUI backs it with a bounded modal menu. Core owns classification, auto-fix,
  // stash, re-verification and merge finalization — the driving side owns only the menu and
  // the editor process (core only ever sees the `edited` choice).
  onUpdateBlocker?: OnUpdateBlocker;
  // The live per-service step observer. Absent on the CLI path; the TUI store backs it with
  // its live phase map. Emitted at phase boundaries (pulling/merging → migrating →
  // restarting), never allowed to throw into the pipeline — a throwing observer is swallowed
  // per emission.
  onPhase?: OnUpdatePhase;
  // Cooperative external cancellation (e.g. an aborted MCP request). Polled at the same step
  // boundaries as the pool's own cancel flag; once true the run is cancelled and remaining
  // services are reported as cancelled/skipped. Nothing is killed.
  shouldCancel?: () => boolean;
  // Fires once per service as soon as its row is final (before the run ends), so a driving
  // side can show a finished service while others still run. Observer-only, like onPhase.
  onServiceResult?: OnServiceResult;
  // How many services are processed at once (bounded pool). Default 1 — the sequential run.
  concurrency?: number;
  // Optional stage of a target: stages run in ascending order, each fully finished before the
  // next starts (a later story runs `shared-types` alone first). Absent: one stage.
  ordering?: (target: { service: string; repoPath: string }) => number;
  // Awaited once each stage has finished (also after the last), with that stage's final rows;
  // it may cancel the run so the remaining stages are reported as cancelled. Generic seam: core
  // knows nothing about what the driving side does between stages. A throwing hook cancels.
  afterStage?: (
    stage: number,
    rows: GroupUpdateRepoResult[],
    control: StageControl,
  ) => void | Promise<void>;
  // Optional conflict auto-resolution seam (generic: core never knows what it resolves). Called
  // on a service whose merge/pull conflicted, before each menu presentation and again after the
  // developer's `edited` choice, so it must be idempotent. It reports whether it settled
  // something and, when it could not settle its part, an issue note shown on the incident.
  autoResolveConflict?: AutoResolveConflict;
}

export interface AutoResolveResult {
  touched: boolean;
  issue?: string;
}

export type AutoResolveConflict = (target: {
  service: string;
  repoPath: string;
}) => Promise<AutoResolveResult>;

// The resolution seam shape. `kind` distinguishes a dirty worktree from a mid-run conflict
// from a pre-existing mid-merge/mid-rebase (surfaced before any menu); the driving side
// answers with one of four bounded choices.
export type UpdateBlockerKind =
  | "dirty-worktree"
  | "merge-conflict"
  | "mid-merge"
  | "mid-rebase"
  | "unpushed-commits";

export interface UpdateBlocker {
  service: string;
  repoPath: string;
  kind: UpdateBlockerKind;
  // Merge-conflict re-presentations only: how many resolution attempts already failed for
  // this conflict (absent on the first prompt) and why the last one did not settle it —
  // the driving side shows both so an endless retry loop stays legible.
  retry?: number;
  retryReason?: string;
  // `unpushed-commits` only: the local branch that could not be fetched into and the
  // `<hash> <subject>` lines of its commits origin does not have.
  branch?: string;
  commits?: string[];
  // `merge-conflict` only: why the auto-resolver could not settle its part of the conflict.
  autoResolveNote?: string;
}

// `fetch` answers an `unpushed-commits` blocker only: core runs a plain `git fetch origin
// <branch>` (local branch untouched) and carries on with the local branch as it stands.
export type UpdateBlockerChoice =
  "stash" | "edited" | "cancel-repo" | "cancel-run" | "fetch";

export type OnUpdateBlocker = (
  blocker: UpdateBlocker,
) => Promise<UpdateBlockerChoice>;

// The live per-service step vocabulary. One optional callback, set by the store, no-op by
// default — no event bus.
export type UpdatePhase = "pulling" | "merging" | "migrating" | "restarting";

export type OnUpdatePhase = (service: string, phase: UpdatePhase) => void;

export type OnServiceResult = (row: GroupUpdateRepoResult) => void;
