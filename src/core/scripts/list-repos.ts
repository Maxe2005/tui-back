// core/scripts/list-repos: the list-repos use-case (AD-2) — turn the registered paths
// into managed repo identities. A registered path is: managed (exists + valid manifest),
// unreachable (path gone from disk — reported, never a crash), silently unmanaged
// (exists but no .tui-back.yaml), or an error entry (manifest fails to load/validate —
// surfaced, never hidden, per AD-3's spirit). Output preserves registry-file order so
// two runs with no intervening change are byte-identical (FR-1).
import { err, ok, type Result } from '../result.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';

export interface ManagedRepo {
  path: string;
  service: string;
  container: string;
  sharedBranch: string;
  moduleIds: string[];
}

export interface RegistryEntryError {
  path: string;
  code: string;
  message: string;
}

export interface ListReposData {
  repos: ManagedRepo[];
  unreachable: string[];
  errors: RegistryEntryError[];
}

export async function listRepos(
  registry: RegistryPort,
  manifest: ManifestPort,
): Promise<Result<ListReposData>> {
  const listed = await registry.list();
  if (!listed.ok) {
    return listed;
  }

  const repos: ManagedRepo[] = [];
  const unreachable: string[] = [];
  const errors: RegistryEntryError[] = [];

  for (const path of listed.data) {
    const exists = await registry.exists(path);
    if (!exists.ok) {
      errors.push({ path, code: exists.error.code, message: exists.error.message });
      continue;
    }
    if (!exists.data) {
      unreachable.push(path);
      continue;
    }

    const loaded = await manifest.load(path);
    if (loaded.ok) {
      repos.push({
        path,
        service: loaded.data.service,
        container: loaded.data.container,
        sharedBranch: loaded.data.sharedBranch,
        moduleIds: Object.keys(loaded.data.modules ?? {}).sort(),
      });
    } else if (loaded.error.code === 'manifest-not-found') {
      // genuinely unmanaged — silently skipped (AC3)
    } else {
      errors.push({ path, code: loaded.error.code, message: loaded.error.message });
    }
  }

  return ok({ repos, unreachable, errors });
}
