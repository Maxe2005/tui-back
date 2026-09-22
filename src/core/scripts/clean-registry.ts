// core/scripts/clean-registry: story 2.33 — classify registered paths into stale
// candidates and remove confirmed ones. Two exported functions, deliberately split
// (Code Map): classifyStaleRegistry never writes anything (safe to call as often as a
// screen/CLI wants, e.g. to re-list after a partial removal); removeStaleRegistryEntries
// only ever touches the exact paths it's given — it never re-classifies, so a caller (CLI
// --yes --path, or the TUI's confirmed checkbox selection) fully owns which paths are
// removed (Boundaries: "never automatic/silent").
//
// classifyStaleRegistry mirrors list-repos.ts's own exists()/manifest.load() walk
// (Code Map) but keeps only the two reasons this story's Boundaries name as stale:
// - unreachable: registry.exists(path) -> false (the repo dir is gone).
// - manifest-not-found: manifest.load(path) fails with exactly that code (repo exists, no
//   .tui-back.yaml — genuinely unmanaged, same condition list-repos.ts silently skips).
// Any other manifest-load error (invalid YAML, unknown-module, schema failure, ...) is left
// alone — that's Story 2.28's manifest-validation territory, never this story's to prune.
// A registry.exists() error is left alone too (inconclusive, not evidence of staleness).
//
// memberOfEdts is a display-only note (Design Notes): every EdtRegistryEntry whose
// members[].repoPath matches the candidate path, by topic. It never gates removal and
// edts.yaml is never written by this use-case or by removeStaleRegistryEntries — an EDT
// whose member's registry entry disappears is already handled by switchActiveEdt's existing
// repo-not-registered failed-row path (Story 2.4 review patch).
//
// Review fix (story 2.33): a registry.exists() error used to be silently swallowed (treated
// identically to "not stale, leave alone" — zero signal to the caller that the path
// couldn't even be checked). Mirrors list-repos.ts's own RegistryEntryError bucket instead —
// an inconclusive path is reported in `errors`, distinct from both `candidates` and from a
// path that's genuinely healthy.
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
  // Review fix (story 2.33): paths whose staleness couldn't be determined at all (a
  // registry.exists() error) — never silently dropped, never treated as evidence either way.
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
    // Inconclusive, not evidence of staleness — reported in `errors`, never silently
    // dropped (review fix) and never guessed at as either stale or healthy.
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

// Per-path isolation (Boundaries): one path's registry.remove failure never blocks the
// others — mirrors create.ts/switch.ts/delete.ts's own per-repo isolation convention, one
// `removed`/`failed` outcome row per path. removeRegistry itself is `add`'s read-modify-write
// shape, so removing an already-unregistered path is a no-op success -> `removed`.
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
