// core/scripts/register: the register use-case (AD-2) — persist one absolute local path
// into the managed-repo registry. Deliberately shallow: no manifest/existence check of
// the target (a path may be registered before its repo exists; that's what list-repos'
// unreachable reporting is for). Relative paths are rejected so stored paths stay
// unambiguous. registry.add does the dedupe (FR-1 idempotency).
import { isAbsolute } from 'node:path';
import { err, ok, type Result } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';

export async function registerRepo(
  registry: RegistryPort,
  path: string | undefined,
): Promise<Result<{ path: string }>> {
  if (path === undefined) {
    return err('missing-argument', 'Usage: tui-back register <path>');
  }
  if (!isAbsolute(path)) {
    return err('invalid-argument', `Path must be absolute: ${path}`);
  }

  const added = await registry.add(path);
  if (!added.ok) {
    return added;
  }
  return ok({ path });
}
