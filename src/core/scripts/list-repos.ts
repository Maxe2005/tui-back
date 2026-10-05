// core/scripts/list-repos: turns the registered paths into managed repo identities. A path is
// managed (exists + valid manifest), unreachable (gone from disk — reported, never a crash),
// silently unmanaged (no .tui-back.yaml), or an error entry (manifest fails to load/validate —
// surfaced, never hidden). Output keeps registry-file order so reruns are identical (FR-1).
import { err, ok, type Result } from '../result.js';
import type { ManifestPort } from '../ports/manifest.js';
import type { RegistryPort } from '../ports/registry.js';

export interface ManagedRepo {
  path: string;
  service: string;
  container: string | null;
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
      // A blank container is as absent as a missing one (the loader rejects blanks, but a
      // ManifestPort is any implementation) — downstream treats both as `no container`.
      const rawContainer = loaded.data.container;
      repos.push({
        path,
        service: loaded.data.service,
        container: rawContainer !== undefined && rawContainer.trim() !== '' ? rawContainer : null,
        sharedBranch: loaded.data.sharedBranch,
        moduleIds: Object.keys(loaded.data.modules ?? {}).sort(),
      });
    } else if (loaded.error.code === 'manifest-not-found') {
      // genuinely unmanaged — silently skipped
    } else {
      errors.push({ path, code: loaded.error.code, message: loaded.error.message });
    }
  }

  return ok({ repos, unreachable, errors });
}
