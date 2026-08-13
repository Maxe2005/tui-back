// core/scripts/register: the register use-case (AD-2) — persist one absolute local path
// into the managed-repo registry. Deliberately shallow: no manifest/existence check of
// the target (a path may be registered before its repo exists; that's what list-repos'
// unreachable reporting is for). Relative paths are rejected so stored paths stay
// unambiguous; the path is canonicalized before storage so `/a/b/` and `/a/b` dedupe to one
// entry. registry.add does the dedupe (FR-1 idempotency).
import { isAbsolute, resolve } from 'node:path';
import { err, ok, type Result } from '../result.js';
import type { RegistryPort } from '../ports/registry.js';
import type { LockPort } from '../ports/lock.js';
import { withActionLock } from '../locking.js';

export async function registerRepo(
  registry: RegistryPort,
  lock: LockPort,
  resourceKey: string,
  path: string | undefined,
): Promise<Result<{ path: string }>> {
  if (path === undefined) {
    return err('missing-argument', 'Usage: tui-back register <path>');
  }
  if (!isAbsolute(path)) {
    return err('invalid-argument', `Path must be absolute: ${path}`);
  }

  const canonical = resolve(path);
  const registered = await withActionLock(lock, resourceKey, () => registry.add(canonical));
  if (!registered.ok) {
    return registered;
  }
  return ok({ path: canonical });
}
