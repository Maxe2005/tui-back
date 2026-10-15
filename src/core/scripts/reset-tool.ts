// core/scripts/reset-tool: the `:reset` command's use-case — wipes the selected data categories
// (edts, histories, services; services always implies edts) without touching git. Each
// category runs under its action lock and reports its own outcome; nothing is rolled back.
// Missing files are an empty, successful category. Unrelated to ./reset.ts (register --reset)
// despite the name.
import { readdir, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { withActionLock } from '../locking.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockPort } from '../ports/lock.js';
import type { RegistryPort } from '../ports/registry.js';
import type { StatePort } from '../ports/state.js';
import { err, ok, type Result, type ResultError } from '../result.js';

export type ResetCategory = 'edts' | 'histories' | 'services';

// Execution order: EDTs first, then histories, then services.
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
    } else if (outcomes.edts?.outcome === 'failed') {
      // services ⇒ edts holds at execution time too: never leave EDTs whose member services
      // were just unregistered. Histories are independent and still ran above.
      result = err('reset-skipped-edts-failed', 'Skipped because the EDT reset failed');
    } else {
      result = await resetServices(params);
    }
    outcomes[category] = result.ok ? { outcome: 'ok' } : { outcome: 'failed', error: result.error };
  }

  return ok({ outcomes, leftBranches });
}

async function resetEdts(params: ResetToolParams, leftBranches: LeftBehindBranch[]): Promise<Result<void>> {
  const { edtRegistry, state, lock, keys, edtsBaseDir } = params;
  // Defensive guard before any recursive delete: an empty or relative base dir would resolve
  // against the process cwd — never wipe anything but an explicit absolute EDT data dir.
  if (edtsBaseDir.trim() === '' || !isAbsolute(edtsBaseDir)) {
    return err('invalid-argument', `Refusing to wipe EDT data: edtsBaseDir must be an absolute path (got "${edtsBaseDir}")`);
  }
  return withActionLock(lock, keys.edtRegistry, async () => {
    const listed = await edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }

    // The pointer is cleared *before* anything is removed, so a failure partway through the
    // removals or the directory wipe below can never leave state.json naming a removed EDT.
    // A failed read is this category's failure — never assumed empty and written over.
    const active = await state.readActiveEdt();
    if (!active.ok) {
      return active;
    }
    if (active.data !== null) {
      const cleared = await state.writeActiveEdt(null);
      if (!cleared.ok) {
        return cleared;
      }
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

    return wipeDirectoryContents(edtsBaseDir);
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
  // Each history is cleared independently — a failed read is that history's failure, never
  // assumed empty and written over — and the first failure is the category's result.
  const filter = await state.readFilterHistory();
  if (!filter.ok) {
    return filter;
  }
  const command = await state.readCommandHistory();
  if (!command.ok) {
    return command;
  }
  // Nothing persisted (no state.json, or no such key) — nothing to clear.
  if (filter.data !== null) {
    const written = await state.writeFilterHistory({});
    if (!written.ok) {
      return written;
    }
  }
  return command.data === null ? ok(undefined) : state.writeCommandHistory([]);
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
