// cli/commands/edt-fast-forward-shared: `edt fast-forward-shared` — fast-forwards each managed
// service's local shared branch from origin without switching EDT. Needs the
// "Shared branches" EDT setting on (`edt-not-found` otherwise); exits non-zero when any row failed.
import { err, ok, type Result } from '../../../../core/result.js';
import { anyFastForwardFailed, fastForwardShared, FAST_FORWARD_FAILED_CODE } from '../../../../core/edt/branches/fast-forward-shared.js';
import type { GitPort } from '../../../../core/ports/git.js';
import type { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';

export const EDT_FAST_FORWARD_SHARED_USAGE = 'tui-back edt fast-forward-shared';

export async function runEdtFastForwardShared(
  deps: { edtRegistry: EdtRegistryPort; git: GitPort },
  args: string[],
): Promise<Result<unknown>> {
  if (args.length !== 0) {
    return err('invalid-argument', `Usage: ${EDT_FAST_FORWARD_SHARED_USAGE}`);
  }
  const result = await fastForwardShared({ edtRegistry: deps.edtRegistry, git: deps.git });
  if (!result.ok) {
    return result;
  }
  return anyFastForwardFailed(result.data.rows)
    ? err(FAST_FORWARD_FAILED_CODE, 'At least one shared branch could not be fast-forwarded', result.data)
    : ok(result.data);
}
