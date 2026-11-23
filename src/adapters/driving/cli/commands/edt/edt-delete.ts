// cli/commands/edt-delete: `edt delete` usage, flag parsing and runner.
import { resolve } from 'node:path';
import { err, type Result } from '../../../../../core/result.js';
import { deleteEdt, type MemberDisposition } from '../../../../../core/edt/lifecycle/delete.js';
import { GitPort } from '../../../../../core/ports/vcs/git.js';
import { ManifestPort } from '../../../../../core/ports/vcs/manifest.js';
import { EdtRegistryPort } from '../../../../../core/ports/storage/edt-registry.js';
import { LockPort } from '../../../../../core/ports/runtime/lock.js';
import { StatePort } from '../../../../../core/ports/storage/state.js';

export const EDT_DELETE_USAGE =
  'tui-back edt delete <topic> [--branches <repoPath>=<leave|delete>]... ' +
  '(a member with no matching --branches entry defaults to leave; the active EDT can never be deleted)';

// Hand-rolled flag parsing for `edt delete`: a positional <topic> (unlike modify/switch's
// --topic flag) plus repeated `--branches <repoPath>=<leave|delete>`. A member with no
// matching --branches entry defaults to 'leave' — deleteEdt itself treats an absent
// disposition that way.
export async function runEdtDelete(
  deps: {
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    manifest: ManifestPort;
    git: GitPort;
    lock: LockPort;
    state: StatePort;
    edtsBaseDir: string;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  const dispositions: Record<string, MemberDisposition> = {};

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--branches') {
      const value = args[i + 1];
      if (value === undefined) {
        return err('invalid-argument', `Missing value for --branches. Usage: ${EDT_DELETE_USAGE}`);
      }
      const eq = value.indexOf('=');
      if (eq === -1) {
        return err('invalid-argument', `--branches must be <repoPath>=<leave|delete>, got "${value}"`);
      }
      const rawPath = value.slice(0, eq);
      // An empty repoPath before "=" (e.g. "--branches =delete") would resolve to
      // process.cwd() — reject it instead of guessing.
      if (rawPath.trim() === '') {
        return err('invalid-argument', `--branches "${value}" is missing a repoPath before "="`);
      }
      const path = resolve(rawPath);
      const disposition = value.slice(eq + 1);
      if (disposition !== 'leave' && disposition !== 'delete') {
        return err('invalid-argument', `--branches disposition must be "leave" or "delete", got "${disposition}"`);
      }
      // A --branches repeated for the same resolved repoPath is rejected rather than letting
      // the later value silently win.
      if (Object.prototype.hasOwnProperty.call(dispositions, path)) {
        return err('invalid-argument', `--branches "${rawPath}" was specified more than once`);
      }
      dispositions[path] = disposition;
      i += 1;
      continue;
    }
    if (flag !== undefined && !flag.startsWith('--') && topic === undefined) {
      topic = flag;
      continue;
    }
    return err('invalid-argument', `Unknown edt delete option: "${flag}". Usage: ${EDT_DELETE_USAGE}`);
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing <topic>. Usage: ${EDT_DELETE_USAGE}`);
  }

  // A --branches repoPath that isn't one of the target EDT's own members is rejected, naming
  // the unmatched path(s) — a typo deserves a loud failure, not a silent 'leave'. Skipped when
  // the topic itself isn't found: deleteEdt's own edt-not-found covers that, and there is no
  // real membership to validate --branches against.
  if (Object.keys(dispositions).length > 0) {
    const listed = await deps.edtRegistry.list();
    if (!listed.ok) {
      return listed;
    }
    const target = listed.data.find((candidate) => candidate.topic === topic);
    if (target !== undefined) {
      const memberPaths = new Set(target.members.map((member) => resolve(member.repoPath)));
      const unmatched = Object.keys(dispositions).filter((path) => !memberPaths.has(path));
      if (unmatched.length > 0) {
        return err(
          'invalid-argument',
          `--branches repoPath(s) not found among EDT "${topic}"'s members: ${unmatched.join(', ')}`,
        );
      }
    }
  }

  return deleteEdt({
    edtRegistry: deps.edtRegistry,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    manifest: deps.manifest,
    git: deps.git,
    lock: deps.lock,
    state: deps.state,
    edtsBaseDir: deps.edtsBaseDir,
    topic,
    dispositions,
  });
}
