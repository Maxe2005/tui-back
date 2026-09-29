// core/scripts/reset-tool: the `:reset` command's use-case — wipes selected tui-back data
// categories so a developer can start testing from a clean slate without hand-deleting files
// across three XDG dirs. Unrelated to ./reset.ts (register --reset, corrupt-registry recovery)
// despite the name.
//
// Categories (spec-reset-command.md, Boundaries):
//   - edts: every edts.yaml entry removed, every child of edtsBaseDir (per-EDT dirs,
//     <ulid>.db action logs) deleted, state.json's activeEdt set to null.
//   - histories: state.json's filterHistory emptied (the only persisted history today).
//   - services: every registry.yaml entry removed. Services always implies edts (an EDT
//     whose member services are unregistered is meaningless) — enforced here, not only in
//     the TUI checkbox logic.
//
// Git is never touched: member branches and `tui-back:<ulid>` stashes stay. The branches
// left behind by every removed EDT are returned so the caller can list them.
//
// Mutations run under the existing action locks (edt registry key, registry key). A category
// failing (lock held, I/O error) never stops the others — each reports its own outcome, and
// nothing is rolled back. Missing files (ENOENT) are never an error: an empty category is a
// successful no-op. Direct node:fs for the edtsBaseDir wipe mirrors delete.ts's
// deleteEdtFiles precedent (AD-1: no port method for per-EDT file cleanup).
import { readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockPort } from '../ports/lock.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result, type ResultError } from '../result.js';

export type ResetCategory = 'edts' | 'histories' | 'services';

// Execution order (Design Notes): EDTs first, then histories, then services.
export const RESET_CATEGORIES: readonly ResetCategory[] = ['edts', 'histories', 'services'];

export type ResetCategoryOutcome = { outcome: 'ok' } | { outcome: 'failed'; error: ResultError };

export interface LeftBehindBranch {
  topic: string;
  service: string;
  repoPath: string;
  branch: string;
}

export interface ResetToolData {
  // Only the categories that actually ran (the requested ones, plus edts when services was
  // requested) have an entry.
  outcomes: Partial<Record<ResetCategory, ResetCategoryOutcome>>;
  leftBranches: LeftBehindBranch[];
}

export interface ResetToolParams {
  categories: readonly ResetCategory[];
  edtRegistry: EdtRegistryPort;
  registry: RegistryPort;
  state: StatePort;
  lock: LockPort;
  keys: { edtRegistry: string; registry: string };
  edtsBaseDir: string;
}

// Services ⇒ EDTs, and de-duplicated into execution order.
export function resolveResetCategories(requested: readonly ResetCategory[]): ResetCategory[] {
  const wanted = new Set(requested);
  if (wanted.has('services')) {
    wanted.add('edts');
  }
  return RESET_CATEGORIES.filter((category) => wanted.has(category));
}

export async function resetTool(params: ResetToolParams): Promise<Result<ResetToolData>> {
  const categories = resolveResetCategories(params.categories);
  if (categories.length === 0) {
    return err('missing-argument', 'Select at least one category to reset');
  }

  const outcomes: Partial<Record<ResetCategory, ResetCategoryOutcome>> = {};
  const leftBranches: LeftBehindBranch[] = [];

  for (const category of categories) {
    let result: Result<void>;
    if (category === 'edts') {
      result = await resetEdts(params, leftBranches);
    } else if (category === 'histories') {
      result = await resetHistories(params.state);
    } else {
      result = await resetServices(params);
    }
    outcomes[category] = result.ok ? { outcome: 'ok' } : { outcome: 'failed', error: result.error };
  }

  return ok({ outcomes, leftBranches });
}

async function resetEdts(params: ResetToolParams, leftBranches: LeftBehindBranch[]): Promise<Result<void>> {
  const { edtRegistry, state, lock, keys, edtsBaseDir } = params;
  return withActionLock(lock, keys.edtRegistry, async () => {
    const listed = await edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }
    for (const entry of listed.data) {
      const removed = await edtRegistry.remove(entry.ulid);
      // edt-not-found: already gone (e.g. a concurrent CLI delete) — the goal is met.
      if (!removed.ok && removed.error.code !== 'edt-not-found') {
        return removed;
      }
      // Recorded per removed entry, so a mid-list failure still reports the branches of the
      // EDTs that were actually removed.
      for (const member of entry.members) {
        leftBranches.push({ topic: entry.topic, service: member.service, repoPath: member.repoPath, branch: member.branch });
      }
    }

    const wiped = await wipeDirectoryContents(edtsBaseDir);
    if (!wiped.ok) {
      return wiped;
    }

    const active = await state.readActiveEdt();
    if (active.ok && active.data === null) {
      // Nothing to clear — leave state.json (possibly absent) untouched.
      return ok(undefined);
    }
    return state.writeActiveEdt(null);
  });
}

async function wipeDirectoryContents(dir: string): Promise<Result<void>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok(undefined);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('reset-fs-error', `Failed to list ${dir}: ${detail}`);
  }
  const failures: string[] = [];
  for (const name of names) {
    const target = join(dir, name);
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      failures.push(`${target}: ${detail}`);
    }
  }
  if (failures.length > 0) {
    return err('reset-fs-error', `Failed to delete ${failures.length} item(s) in ${dir}: ${failures.join('; ')}`);
  }
  return ok(undefined);
}

async function resetHistories(state: StatePort): Promise<Result<void>> {
  const current = await state.readFilterHistory();
  if (current.ok && current.data === null) {
    // Nothing persisted (no state.json, or no filterHistory key) — nothing to clear.
    return ok(undefined);
  }
  return state.writeFilterHistory({});
}

async function resetServices(params: ResetToolParams): Promise<Result<void>> {
  const { registry, lock, keys } = params;
  return withActionLock(lock, keys.registry, async () => {
    const listed = await registry.list();
    if (!listed.ok) {
      return listed;
    }
    for (const path of listed.data) {
      const removed = await registry.remove(path);
      if (!removed.ok) {
        return removed;
      }
    }
    return ok(undefined);
  });
}
