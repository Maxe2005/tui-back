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
import { withActionLock } from '../locking.js';
import type { EdtRegistryPort } from '../ports/edt-registry.js';
import type { LockPort } from '../ports/lock.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';
import { ok, type Result } from '../result.js';

export type StaleRegistryReason = 'unreachable' | 'manifest-not-found';

export interface StaleRegistryEntry {
  path: string;
  reason: StaleRegistryReason;
  memberOfEdts: string[];
}

export interface ClassifyStaleRegistryData {
  candidates: StaleRegistryEntry[];
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
  for (const path of listed.data) {
    const reason = await classifyOne(registry, manifest, path);
    if (reason === undefined) {
      continue;
    }
    const memberOfEdts = edtEntries.data
      .filter((entry) => entry.members.some((member) => member.repoPath === path))
      .map((entry) => entry.topic);
    candidates.push({ path, reason, memberOfEdts });
  }

  return ok({ candidates });
}

async function classifyOne(
  registry: RegistryPort,
  manifest: ManifestPort,
  path: string,
): Promise<StaleRegistryReason | undefined> {
  const exists = await registry.exists(path);
  if (!exists.ok) {
    // Inconclusive, not evidence of staleness — left alone (matches list-repos.ts's own
    // errors-are-surfaced-not-guessed-at spirit, but this use-case's job is only to name
    // candidates, not to report every registry error).
    return undefined;
  }
  if (!exists.data) {
    return 'unreachable';
  }

  const loaded = await manifest.load(path);
  if (loaded.ok) {
    return undefined;
  }
  return loaded.error.code === 'manifest-not-found' ? 'manifest-not-found' : undefined;
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
