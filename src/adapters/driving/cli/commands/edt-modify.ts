// cli/commands/edt-modify: `edt modify` usage, flag parsing and runner.
import { resolve } from 'node:path';
import { err, type Result } from '../../../../core/result.js';
import { modifyEdt } from '../../../../core/edt/lifecycle/modify.js';
import { GitPort } from '../../../../core/ports/git.js';
import { ManifestPort } from '../../../../core/ports/manifest.js';
import { RegistryPort } from '../../../../core/ports/registry.js';
import { EdtRegistryPort } from '../../../../core/ports/edt-registry.js';
import { LockPort } from '../../../../core/ports/lock.js';

export const EDT_MODIFY_USAGE =
  'tui-back edt modify --topic <topic> [--add-member <path> --set-branch <path>=<branch>]... [--remove-member <path>]... [--set-branch <path>=<branch>]... [--rename-to <topic>]' +
  ' (each --add-member requires a matching --set-branch for that same path — no current-branch default)';

// Hand-rolled flag parsing for `edt modify`: the wrapper owns flag syntax (unknown options,
// missing values, --to given at most once, repeated --add-member/--remove-member/--set-branch
// <path>=<name>); the use-case owns the semantic validations (topic resolution, membership
// gating, branch-gate, rename uniqueness, per-repo failure isolation).
export async function runEdtModify(
  deps: {
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    registry: RegistryPort;
    manifest: ManifestPort;
    git: GitPort;
    lock: LockPort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  const rawAddMembers: string[] = [];
  const rawRemoveMembers: string[] = [];
  const rawSetBranches: Array<{ repoPath: string; branch: string }> = [];
  let renameTo: string | undefined;
  let sawFlag = false;

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    sawFlag = true;
    switch (flag) {
      case '--topic':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --topic. Usage: ${EDT_MODIFY_USAGE}`);
        }
        topic = value;
        i += 1;
        break;
      case '--add-member':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --add-member. Usage: ${EDT_MODIFY_USAGE}`);
        }
        rawAddMembers.push(value);
        i += 1;
        break;
      case '--remove-member':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --remove-member. Usage: ${EDT_MODIFY_USAGE}`);
        }
        rawRemoveMembers.push(value);
        i += 1;
        break;
      case '--set-branch':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --set-branch. Usage: ${EDT_MODIFY_USAGE}`);
        }
        const eq = value.indexOf('=');
        if (eq === -1) {
          return err('invalid-argument', `--set-branch must be <path>=<branch> in modify mode, got "${value}"`);
        }
        const path = resolve(value.slice(0, eq));
        const name = value.slice(eq + 1);
        if (name.trim() === '') {
          return err('invalid-argument', `--set-branch "${value}" has an empty branch name`);
        }
        rawSetBranches.push({ repoPath: path, branch: name });
        i += 1;
        break;
      case '--rename-to':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --rename-to. Usage: ${EDT_MODIFY_USAGE}`);
        }
        renameTo = value;
        i += 1;
        break;
      default:
        return err('invalid-argument', `Unknown edt modify option: "${flag}". Usage: ${EDT_MODIFY_USAGE}`);
    }
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing --topic. Usage: ${EDT_MODIFY_USAGE}`);
  }

  // At least one operation required
  const hasOp = rawAddMembers.length > 0 || rawRemoveMembers.length > 0 || rawSetBranches.length > 0 || (renameTo !== undefined);
  if (!hasOp) {
    return err('invalid-argument', 'At least one operation required: --add-member, --remove-member, --set-branch, or --rename-to');
  }

  return modifyEdt({
    edtRegistry: deps.edtRegistry,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    registry: deps.registry,
    manifest: deps.manifest,
    git: deps.git,
    lock: deps.lock,
    topic,
    addMembers: rawAddMembers,
    removeMembers: rawRemoveMembers,
    setBranches: rawSetBranches,
    renameTo,
  });
}
