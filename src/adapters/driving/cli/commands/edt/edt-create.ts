// cli/commands/edt-create: `edt create` usage, flag parsing and runner.
import { resolve } from 'node:path';
import { err, type Result } from '../../../../../core/result.js';
import { createEdt } from '../../../../../core/edt/lifecycle/create.js';
import { GitPort } from '../../../../../core/ports/vcs/git.js';
import { ManifestPort } from '../../../../../core/ports/vcs/manifest.js';
import { RegistryPort } from '../../../../../core/ports/storage/registry.js';
import { EdtRegistryPort } from '../../../../../core/ports/storage/edt-registry.js';
import { LockPort } from '../../../../../core/ports/runtime/lock.js';

export const EDT_CREATE_USAGE =
  'tui-back edt create --topic <topic> --member <path> [--create-branches] ' +
  '[--base <branch>] [--branch-mode grouped|individual] [--branch-name <name>|<path>=<name>]';

// Hand-rolled flag parsing for `edt create` (following the register --reset pattern): the
// CLI stays dependency-free, so flags are walked here rather than through an arg parser.
// The use-case owns the semantic validations (topic presence, membership, duplicate topic);
// this wrapper owns the flag syntax (unknown options, missing values, branch-name arity and
// the path=name mapping for individual mode).
export async function runEdtCreate(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    lock: LockPort;
    edtsBaseDir: string;
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    git: GitPort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  const rawMembers: string[] = [];
  let createBranches = false;
  let base = 'development';
  let branchMode: 'grouped' | 'individual' = 'grouped';
  const branchNames: string[] = [];
  let sawBranchFlag = false;

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    switch (flag) {
      case '--topic':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --topic. Usage: ${EDT_CREATE_USAGE}`);
        }
        topic = value;
        i += 1;
        break;
      case '--member':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --member. Usage: ${EDT_CREATE_USAGE}`);
        }
        if (value.trim() === '') {
          return err('invalid-argument', `Empty --member value is not allowed. Usage: ${EDT_CREATE_USAGE}`);
        }
        rawMembers.push(value);
        i += 1;
        break;
      case '--create-branches':
        createBranches = true;
        break;
      case '--base':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --base. Usage: ${EDT_CREATE_USAGE}`);
        }
        base = value;
        sawBranchFlag = true;
        i += 1;
        break;
      case '--branch-mode':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --branch-mode. Usage: ${EDT_CREATE_USAGE}`);
        }
        if (value !== 'grouped' && value !== 'individual') {
          return err('invalid-argument', `--branch-mode must be "grouped" or "individual", got "${value}"`);
        }
        branchMode = value;
        sawBranchFlag = true;
        i += 1;
        break;
      case '--branch-name':
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --branch-name. Usage: ${EDT_CREATE_USAGE}`);
        }
        branchNames.push(value);
        sawBranchFlag = true;
        i += 1;
        break;
      default:
        return err('invalid-argument', `Unknown edt create option: "${flag}". Usage: ${EDT_CREATE_USAGE}`);
    }
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing --topic. Usage: ${EDT_CREATE_USAGE}`);
  }
  if (rawMembers.length === 0) {
    return err('invalid-member', `At least one --member is required. Usage: ${EDT_CREATE_USAGE}`);
  }

  // Members are canonicalized (resolve) the same way the registry stores registered paths
  // and the branch-name keys must match them 1:1. Duplicate values are rejected rather than
  // deduped: two identical --member flags mean a typo, and silently dropping one would
  // silently change which repos were selected.
  const members = rawMembers.map((member) => resolve(member));
  const seenMembers = new Set<string>();
  for (const member of members) {
    if (seenMembers.has(member)) {
      return err('invalid-argument', `Duplicate --member: ${member}`);
    }
    seenMembers.add(member);
  }
  if (!createBranches && sawBranchFlag) {
    return err('invalid-argument', '--base/--branch-mode/--branch-name require --create-branches');
  }

  const names: Record<string, string> = {};
  if (createBranches) {
    if (branchMode === 'grouped') {
      if (branchNames.length !== 1) {
        return err('invalid-argument', `Grouped branch mode needs exactly one --branch-name. Usage: ${EDT_CREATE_USAGE}`);
      }
      if (branchNames[0].trim() === '') {
        return err('invalid-argument', '--branch-name must not be empty');
      }
      for (const member of members) {
        names[member] = branchNames[0];
      }
    } else {
      if (branchNames.length !== members.length) {
        return err(
          'invalid-argument',
          `Individual branch mode needs one --branch-name <path>=<name> per member. Usage: ${EDT_CREATE_USAGE}`,
        );
      }
      for (const raw of branchNames) {
        const eq = raw.indexOf('=');
        if (eq === -1) {
          return err('invalid-argument', `--branch-name must be <path>=<name> in individual mode, got "${raw}"`);
        }
        const path = resolve(raw.slice(0, eq));
        const name = raw.slice(eq + 1);
        if (name.trim() === '') {
          return err('invalid-argument', `--branch-name "${raw}" has an empty branch name`);
        }
        if (!members.includes(path)) {
          return err('invalid-argument', `--branch-name "${raw}" names a non-member path`);
        }
        if (names[path] !== undefined) {
          return err('invalid-argument', `Multiple --branch-name entries for member ${path}`);
        }
        names[path] = name;
      }
    }
  }

  return createEdt({
    edtsBaseDir: deps.edtsBaseDir,
    manifest: deps.manifest,
    edtRegistry: deps.edtRegistry,
    lock: deps.lock,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    registry: deps.registry,
    git: deps.git,
    topic,
    members,
    branchOptions: { create: createBranches, base, mode: branchMode, names },
  });
}
