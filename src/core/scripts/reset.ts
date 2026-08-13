// core/scripts/reset: the register --reset recovery use-case (AD-2) — repair a corrupt
// registry.yaml. Exclusively targets the corrupt-file case: the driven adapter backs up
// the corrupt file (registry.yaml.bak-<ts>, original content preserved) and re-initializes
// the registry with the given path; a healthy registry is never touched (registry-not-corrupt).
// Validations mirror register (missing-argument, invalid-argument for relative paths) so
// the recovery path is unambiguous and idempotent (FR-1).
import { isAbsolute, resolve } from 'node:path';
import { err, ok, type Result } from '../result.js';
import type { RegistryPort, ResetResult } from '../ports/registry.js';
import type { LockPort } from '../ports/lock.js';
import { withActionLock } from '../locking.js';

export async function resetRepo(
  registry: RegistryPort,
  lock: LockPort,
  resourceKey: string,
  path: string | undefined,
): Promise<Result<ResetResult>> {
  if (path === undefined) {
    return err('missing-argument', 'Usage: tui-back register --reset <path>');
  }
  if (!isAbsolute(path)) {
    return err('invalid-argument', `Path must be absolute: ${path}`);
  }

  const reset = await withActionLock(lock, resourceKey, () => registry.reset(resolve(path)));
  if (!reset.ok) {
    return reset;
  }
  return ok(reset.data);
}
