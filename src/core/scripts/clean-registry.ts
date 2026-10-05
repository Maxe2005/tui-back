// core/scripts/clean-registry: classifies registered paths into stale candidates (unreachable,
// or no .tui-back.yaml) and removes confirmed ones. classifyStaleRegistry never writes;
// removeStaleRegistryEntries only touches the exact paths it's given, so the caller owns what
// is removed. Other manifest errors and inconclusive exists() checks are never pruned.
// memberOfEdts is a display-only note — edts.yaml is never written here.
import { withActionLock } from '../locking.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { ok, type Result } from '../result.js';
import type { RegistryEntryError } from './list-repos.js';

export type { RegistryEntryError } from './list-repos.js';

export type StaleRegistryReason = 'unreachable' | 'manifest-not-found';

export interface StaleRegistryEntry {
  path: string;
  reason: StaleRegistryReason;
  memberOfEdts: string[];
}

export interface ClassifyStaleRegistryData {
  candidates: StaleRegistryEntry[];
  // Paths whose staleness couldn't be determined at all (a registry.exists() error) — never
  // silently dropped, never treated as evidence either way.
  errors: RegistryEntryError[];
}

export interface ClassifyStaleRegistryParams {
  registry: RegistryPort;
  manifest: ManifestPort;
  edtRegistry: EdtRegistryPort;
}

export async function classifyStaleRegistry(
  params: ClassifyStaleRegistryParams,
): Promise<Result<ClassifyStaleRegistryData>> {
  const { registry, manifest, edtRegistry } = params;

  const listed = await registry.list();
  if (!listed.ok) {
    return listed;
  }
  const edtEntries = await edtRegistry.list();
  if (!edtEntries.ok) {
    return edtEntries;
  }

  const candidates: StaleRegistryEntry[] = [];
  const errors: RegistryEntryError[] = [];
  for (const path of listed.data) {
    const classified = await classifyOne(registry, manifest, path);
    if (classified.kind === 'error') {
      errors.push({ path, code: classified.code, message: classified.message });
      continue;
    }
    if (classified.kind === 'none') {
      continue;
    }
    const memberOfEdts = edtEntries.data
      .filter((entry) => entry.members.some((member) => member.repoPath === path))
      .map((entry) => entry.topic);
    candidates.push({ path, reason: classified.reason, memberOfEdts });
  }

  return ok({ candidates, errors });
}

type ClassifyOneResult =
  | { kind: 'stale'; reason: StaleRegistryReason }
  | { kind: 'none' }
  | { kind: 'error'; code: string; message: string };

async function classifyOne(registry: RegistryPort, manifest: ManifestPort, path: string): Promise<ClassifyOneResult> {
  const exists = await registry.exists(path);
  if (!exists.ok) {
    // Inconclusive, not evidence of staleness — reported in `errors`, never silently dropped
    // and never guessed at as either stale or healthy.
    return { kind: 'error', code: exists.error.code, message: exists.error.message };
  }
  if (!exists.data) {
    return { kind: 'stale', reason: 'unreachable' };
  }

  const loaded = await manifest.load(path);
  if (loaded.ok) {
    return { kind: 'none' };
  }
  return loaded.error.code === 'manifest-not-found' ? { kind: 'stale', reason: 'manifest-not-found' } : { kind: 'none' };
}

export type RemoveStaleRegistryOutcome = 'removed' | 'failed';

export interface RemoveStaleRegistryEntryResult {
  path: string;
  outcome: RemoveStaleRegistryOutcome;
  detail?: { code: string; message: string };
}

export interface RemoveStaleRegistryEntriesData {
  results: RemoveStaleRegistryEntryResult[];
}

export interface RemoveStaleRegistryEntriesParams {
  registry: RegistryPort;
  lock: LockPort;
  registryResourceKey: string;
}

// Per-path isolation: one path's registry.remove failure never blocks the others — one
// `removed`/`failed` outcome row per path. Removing an already-unregistered path is a no-op
// success -> `removed`.
export async function removeStaleRegistryEntries(
  params: RemoveStaleRegistryEntriesParams,
  paths: string[],
): Promise<Result<RemoveStaleRegistryEntriesData>> {
  const { registry, lock, registryResourceKey } = params;
  const results: RemoveStaleRegistryEntryResult[] = [];

  for (const path of paths) {
    const removed = await withActionLock(lock, registryResourceKey, () => registry.remove(path));
    if (removed.ok) {
      results.push({ path, outcome: 'removed' });
    } else {
      results.push({ path, outcome: 'failed', detail: { code: removed.error.code, message: removed.error.message } });
    }
  }

  return ok({ results });
}
