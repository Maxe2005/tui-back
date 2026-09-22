// adapters/driving/cli/subcommands: the production subcommand registry (AD-2). Each entry
// is a thin wrapper around exactly one core use-case; the first story registering more than
// one subcommand, so it also owns the duplicate-name guard (assertUniqueSubcommandNames)
// that would otherwise let a future registry silently shadow an earlier subcommand.
// Wrappers also validate argument cardinality so a typo'd or excess argument is an explicit
// invalid-argument error instead of a silently ignored one.
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { err, ok, type Result } from '../../../core/result.js';
import { ping } from '../../../core/ping.js';
import { createEdt } from '../../../core/edt/create.js';
import { switchActiveEdt } from '../../../core/edt/switch.js';
import { modifyEdt } from '../../../core/edt/modify.js';
import { deleteEdt, type MemberDisposition } from '../../../core/edt/delete.js';
import { listEdtBranchesDivergence } from '../../../core/edt/list.js';
import { groupUpdate } from '../../../core/scripts/group-update.js';
import { classifyStaleRegistry, removeStaleRegistryEntries } from '../../../core/scripts/clean-registry.js';
import type { ContainerPort } from '../../../core/ports/container.js';
import type { GitPort } from '../../../core/ports/git.js';
import type { ManifestPort } from '../../../core/ports/manifest.js';
import type { MigrationPort } from '../../../core/ports/migration.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import type { LockPort } from '../../../core/ports/lock.js';
import type { StatePort } from '../../../core/ports/state.js';
import { registerRepo } from '../../../core/scripts/register.js';
import { resetRepo } from '../../../core/scripts/reset.js';
import { listRepos } from '../../../core/scripts/list-repos.js';
import { scanRepos } from '../../../core/scripts/scan.js';
import type { Subcommand } from './dispatch.js';

const EDT_CREATE_USAGE =
  'tui-back edt create --topic <topic> --member <path> [--create-branches] ' +
  '[--base <branch>] [--branch-mode grouped|individual] [--branch-name <name>|<path>=<name>]';
const EDT_SWITCH_USAGE = 'tui-back edt switch --to <topic> [--force]';
const EDT_MODIFY_USAGE =
  'tui-back edt modify --topic <topic> [--add-member <path> --set-branch <path>=<branch>]... [--remove-member <path>]... [--set-branch <path>=<branch>]... [--rename-to <topic>]' +
  ' (each --add-member requires a matching --set-branch for that same path — no current-branch default)';
const EDT_DELETE_USAGE =
  'tui-back edt delete <topic> [--branches <repoPath>=<leave|delete>]... ' +
  '(a member with no matching --branches entry defaults to leave; the active EDT can never be deleted)';
const EDT_USAGE = `${EDT_CREATE_USAGE}\n${EDT_SWITCH_USAGE}\n${EDT_MODIFY_USAGE}\n${EDT_DELETE_USAGE}`;
const UPDATE_USAGE = 'tui-back update | tui-back update --all --yes';
const REGISTRY_CLEAN_USAGE =
  'tui-back registry clean (interactive on a TTY) | tui-back registry clean --yes --path <path>...';
const REGISTRY_USAGE = REGISTRY_CLEAN_USAGE;

export function buildSubcommands(deps: {
  registry: RegistryPort;
  manifest: ManifestPort;
  lock: LockPort;
  registryResourceKey: string;
  edtsBaseDir: string;
  edtRegistry: EdtRegistryPort;
  edtRegistryResourceKey: string;
  git: GitPort;
  container: ContainerPort;
  migration: MigrationPort;
  state: StatePort;
  // Story 2.33: gates `registry clean`'s bare-invocation interactive list-then-confirm
  // prompt. Defaults to false (never prompts) so every existing deps-construction call site
  // (tests, in particular) is unaffected — only bin/main.ts's composition root wires this,
  // and (review fix) only when BOTH stdout and stdin are real TTYs — a piped/redirected
  // stdin must never let `rl.question()` block on or misread a nonexistent live answer.
  isTTY?: boolean;
}): Subcommand[] {
  const subcommands: Subcommand[] = [
    {
      name: 'register',
      usage: 'tui-back register [--reset] <path>',
      run: async (args) => {
        if (args.length === 0) {
          return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, undefined);
        }
        if (args[0] === '--reset') {
          if (args.length > 2) {
            return err('invalid-argument', 'Usage: tui-back register --reset <path>');
          }
          return resetRepo(deps.registry, deps.lock, deps.registryResourceKey, args[1]);
        }
        if (args.length > 1) {
          return err('invalid-argument', 'Usage: tui-back register <path>');
        }
        return registerRepo(deps.registry, deps.lock, deps.registryResourceKey, args[0]);
      },
    },
    {
      name: 'list-repos',
      usage: 'tui-back list-repos',
      run: async (args) =>
        args.length === 0
          ? listRepos(deps.registry, deps.manifest)
          : err('invalid-argument', 'Usage: tui-back list-repos'),
    },
    {
      name: 'scan',
      usage: 'tui-back scan <root>',
      run: async (args) => {
        if (args.length === 0) {
          return scanRepos(deps.registry, undefined);
        }
        if (args.length > 1) {
          return err('invalid-argument', 'Usage: tui-back scan <root>');
        }
        return scanRepos(deps.registry, args[0]);
      },
    },
    {
      name: 'ping',
      usage: 'tui-back ping',
      run: async (args) => (args.length === 0 ? ping() : err('invalid-argument', 'Usage: tui-back ping')),
    },
    {
      name: 'edts',
      usage: 'tui-back edts',
      // Story 2.6 (FR-9): every managed service's current branch + ahead/behind divergence
      // from its own configured upstream, uniformly for EDT members and non-members alike —
      // the same core/edt/list.ts use-case the TUI's EDTs zone will consume in-process
      // (AD-2).
      run: async (args) =>
        args.length === 0
          ? listEdtBranchesDivergence({
              registry: deps.registry,
              manifest: deps.manifest,
              git: deps.git,
              edtRegistry: deps.edtRegistry,
              state: deps.state,
            })
          : err('invalid-argument', 'Usage: tui-back edts'),
    },
    {
      name: 'edt',
      usage: EDT_USAGE,
      run: async (args) => {
        if (args[0] === 'create') {
          return runEdtCreate(deps, args.slice(1));
        }
        if (args[0] === 'switch') {
          return runEdtSwitch(deps, args.slice(1));
        }
        if (args[0] === 'modify') {
          return runEdtModify(deps, args.slice(1));
        }
        if (args[0] === 'delete') {
          return runEdtDelete(deps, args.slice(1));
        }
        const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
        return err('invalid-argument', `Unknown edt action: ${label}. Usage:\n${EDT_USAGE}`);
      },
    },
    {
      name: 'update',
      usage: UPDATE_USAGE,
      // Story 3.3: the bare invocation stays EDT-scoped (3.1/3.2, `--all` never implied);
      // `--all --yes` (order-insensitive) runs the same per-service flow against every
      // managed repo; `--all` alone is a `confirmation-required` rejection naming `--yes`
      // (confirmation stays out of core — a driving concern). Any other flag is an explicit
      // invalid-argument rejection, never silently ignored.
      run: async (args) => {
        // Story 3.4: the CLI explicitly passes no resolution seam — dirty worktrees keep
        // today's `skipped`/`dirty-worktree` rows and conflicts keep the abort-and-report
        // `failed`/`merge-conflict` rows, with no prompt and single-line JSON output.
        if (args.length === 0) {
          return groupUpdate({
            edtRegistry: deps.edtRegistry,
            state: deps.state,
            manifest: deps.manifest,
            git: deps.git,
            container: deps.container,
            migration: deps.migration,
            lock: deps.lock,
            registry: deps.registry,
            scope: 'edt',
            onUpdateBlocker: undefined,
          });
        }
        const sorted = [...args].sort();
        if (sorted.length === 2 && sorted[0] === '--all' && sorted[1] === '--yes') {
          return groupUpdate({
            edtRegistry: deps.edtRegistry,
            state: deps.state,
            manifest: deps.manifest,
            git: deps.git,
            container: deps.container,
            migration: deps.migration,
            lock: deps.lock,
            registry: deps.registry,
            scope: 'all',
            onUpdateBlocker: undefined,
          });
        }
        if (args.length === 1 && args[0] === '--all') {
          return err(
            'confirmation-required',
            `All-repos update touches every managed repo — rerun with --all --yes to confirm. Usage: ${UPDATE_USAGE}`,
          );
        }
        return err('invalid-argument', `Usage: ${UPDATE_USAGE}`);
      },
    },
    {
      name: 'registry',
      usage: REGISTRY_USAGE,
      // Story 2.33: verb-dispatch subcommand, same shape as `edt` above — today's only
      // action is `clean`, but the dispatch shape leaves room for a future registry verb
      // without renaming the subcommand.
      run: async (args) => {
        if (args[0] === 'clean') {
          return runRegistryClean(deps, args.slice(1));
        }
        const label = args[0] === undefined ? '(none)' : `"${args[0]}"`;
        return err('invalid-argument', `Unknown registry action: ${label}. Usage:\n${REGISTRY_USAGE}`);
      },
    },
  ];
  assertUniqueSubcommandNames(subcommands);
  return subcommands;
}

// Hand-rolled flag parsing for `edt create` (following the register --reset pattern): the
// CLI stays dependency-free, so flags are walked here rather than through an arg parser.
// The use-case owns the semantic validations (topic presence, membership, duplicate topic);
// this wrapper owns the flag syntax (unknown options, missing values, branch-name arity and
// the path=name mapping for individual mode).
async function runEdtCreate(
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

// Hand-rolled flag parsing for `edt switch` (same style as runEdtCreate): the wrapper owns
// flag syntax (unknown options, missing value, --to given at most once); the use-case owns
// the semantic validations (topic resolution, no-op idempotency, the lock-peek gate).
async function runEdtSwitch(
  deps: {
    edtRegistry: EdtRegistryPort;
    edtRegistryResourceKey: string;
    registry: RegistryPort;
    manifest: ManifestPort;
    git: GitPort;
    lock: LockPort;
    state: StatePort;
  },
  args: string[],
): Promise<Result<unknown>> {
  let topic: string | undefined;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    switch (flag) {
      case '--to': {
        const value = args[i + 1];
        if (value === undefined) {
          return err('invalid-argument', `Missing value for --to. Usage: ${EDT_SWITCH_USAGE}`);
        }
        if (topic !== undefined) {
          return err('invalid-argument', `--to may only be given once. Usage: ${EDT_SWITCH_USAGE}`);
        }
        topic = value;
        i += 1;
        break;
      }
      case '--force':
        force = true;
        break;
      default:
        return err('invalid-argument', `Unknown edt switch option: "${flag}". Usage: ${EDT_SWITCH_USAGE}`);
    }
  }

  if (topic === undefined) {
    return err('invalid-argument', `Missing --to. Usage: ${EDT_SWITCH_USAGE}`);
  }

  return switchActiveEdt({
    edtRegistry: deps.edtRegistry,
    edtRegistryResourceKey: deps.edtRegistryResourceKey,
    registry: deps.registry,
    manifest: deps.manifest,
    git: deps.git,
    lock: deps.lock,
    state: deps.state,
    topic,
    force,
  });
}

// Hand-rolled flag parsing for `edt modify`: the wrapper owns flag syntax (unknown options,
// missing values, --to given at most once, repeated --add-member/--remove-member/--set-branch
// <path>=<name>); the use-case owns the semantic validations (topic resolution, membership
// gating, branch-gate, rename uniqueness, per-repo failure isolation).
async function runEdtModify(
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

// Hand-rolled flag parsing for `edt delete`: a positional <topic> (mirroring the `<topic>`
// precedent, unlike modify/switch's --topic flag — Code Map) plus repeated
// `--branches <repoPath>=<leave|delete>` (mirrors --set-branch's `<path>=<value>` parsing).
// A member with no matching --branches entry defaults to 'leave' — deleteEdt itself already
// treats an absent disposition that way, so this wrapper never has to fill one in.
async function runEdtDelete(
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
      // Review fix (story 2.29): an empty repoPath before "=" (e.g. "--branches =delete")
      // used to resolve silently to process.cwd() — reject it instead of guessing.
      if (rawPath.trim() === '') {
        return err('invalid-argument', `--branches "${value}" is missing a repoPath before "="`);
      }
      const path = resolve(rawPath);
      const disposition = value.slice(eq + 1);
      if (disposition !== 'leave' && disposition !== 'delete') {
        return err('invalid-argument', `--branches disposition must be "leave" or "delete", got "${disposition}"`);
      }
      // Review fix (story 2.29): a --branches repeated for the same resolved repoPath used to
      // let the later value silently win — reject it instead, same spirit as the unmatched-path
      // check below.
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

  // Review fix (story 2.29): a --branches repoPath that isn't one of the target EDT's own
  // members used to be silently ignored (that "member" just never had its disposition
  // filled in, defaulting to 'leave') — reject it instead, naming the unmatched path(s), the
  // same way a developer typo deserves a loud failure rather than a silent no-op. Skipped
  // when the topic itself isn't found: deleteEdt's own edt-not-found already covers that,
  // and there is no real membership to validate --branches against.
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

// `registry clean` flag parsing + the interactive/scripted split (Boundaries: "list-then-
// confirm interactive on a TTY; --yes + repeated --path <path> for scripted use, consistent
// with update's --all --yes"). Scripted mode (--yes together with at least one --path) never
// classifies — it removes exactly the given paths via removeStaleRegistryEntries, mirroring
// AC4's `registry clean --yes --path <p1> --path <p2>` example. Bare invocation always
// classifies first (so a zero-candidates registry is reported the same way regardless of
// TTY-ness, matrix row "No candidates ... explicit result, never silent"); once candidates
// exist, a non-TTY run is rejected with confirmation-required (same shape as update's `--all`
// alone) rather than silently doing nothing, and a TTY run lists every candidate (path +
// reason + memberOfEdts note) and prompts for one whole-list confirmation before removing.
async function runRegistryClean(
  deps: {
    registry: RegistryPort;
    manifest: ManifestPort;
    edtRegistry: EdtRegistryPort;
    lock: LockPort;
    registryResourceKey: string;
    isTTY?: boolean;
  },
  args: string[],
): Promise<Result<unknown>> {
  let yes = false;
  const paths: string[] = [];
  // Review fix: the same resolved path given via multiple --path flags used to call
  // registry.remove twice and produce a duplicate outcome row — deduped here so
  // removeStaleRegistryEntries only ever sees each path once.
  const seenPaths = new Set<string>();

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--yes') {
      yes = true;
      continue;
    }
    if (flag === '--path') {
      const value = args[i + 1];
      if (value === undefined) {
        return err('invalid-argument', `Missing value for --path. Usage: ${REGISTRY_CLEAN_USAGE}`);
      }
      // Review fix: a value that looks like another flag (e.g. `--path --yes`) is a missing
      // value in disguise, not a literal path — reject it instead of silently consuming it.
      if (value.startsWith('--')) {
        return err(
          'invalid-argument',
          `--path value must not look like a flag: "${value}". Usage: ${REGISTRY_CLEAN_USAGE}`,
        );
      }
      // Review fix: `--path ""` used to resolve() to process.cwd() and could remove an
      // unintended entry — reject an empty/whitespace-only value instead of guessing.
      if (value.trim() === '') {
        return err('invalid-argument', `--path value must not be empty. Usage: ${REGISTRY_CLEAN_USAGE}`);
      }
      const resolved = resolve(value);
      if (!seenPaths.has(resolved)) {
        seenPaths.add(resolved);
        paths.push(resolved);
      }
      i += 1;
      continue;
    }
    return err('invalid-argument', `Unknown registry clean option: "${flag}". Usage: ${REGISTRY_CLEAN_USAGE}`);
  }

  if (yes || paths.length > 0) {
    if (!yes || paths.length === 0) {
      return err(
        'invalid-argument',
        `Scripted use requires --yes together with at least one --path <path>. Usage: ${REGISTRY_CLEAN_USAGE}`,
      );
    }
    return removeStaleRegistryEntries(
      { registry: deps.registry, lock: deps.lock, registryResourceKey: deps.registryResourceKey },
      paths,
    );
  }

  const classified = await classifyStaleRegistry({
    registry: deps.registry,
    manifest: deps.manifest,
    edtRegistry: deps.edtRegistry,
  });
  if (!classified.ok) {
    return classified;
  }
  if (classified.data.candidates.length === 0) {
    // Matrix: "No candidates ... explicit 'no stale entries' result, never silent" — reported
    // the same way whether or not the run is interactive. `errors` still surfaces any path
    // that couldn't even be checked (review fix) — a healthy-looking zero-candidates run
    // never silently hides that.
    return ok({ candidates: [], errors: classified.data.errors, results: [] });
  }

  if (deps.isTTY !== true) {
    return err(
      'confirmation-required',
      `registry clean found ${classified.data.candidates.length} stale ` +
        `${classified.data.candidates.length === 1 ? 'entry' : 'entries'} — rerun with --yes --path <path>... to ` +
        `confirm removal. Usage: ${REGISTRY_CLEAN_USAGE}`,
      { candidates: classified.data.candidates, errors: classified.data.errors },
    );
  }

  process.stdout.write(`Stale registry entries (${classified.data.candidates.length}):\n`);
  for (const candidate of classified.data.candidates) {
    const note = candidate.memberOfEdts.length > 0 ? ` [member of EDT: ${candidate.memberOfEdts.join(', ')}]` : '';
    process.stdout.write(`  ${candidate.path} — ${candidate.reason}${note}\n`);
  }
  // Review fix: a path that couldn't be checked at all used to be invisible — reported here
  // too, distinct from the removable candidate list above.
  if (classified.data.errors.length > 0) {
    process.stdout.write(`Could not be checked (${classified.data.errors.length}, left alone):\n`);
    for (const error of classified.data.errors) {
      process.stdout.write(`  ${error.path} — ${error.code}: ${error.message}\n`);
    }
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let answer: string;
  try {
    answer = await rl.question(`Remove ${classified.data.candidates.length === 1 ? 'this entry' : 'these entries'}? [y/N] `);
  } finally {
    rl.close();
  }

  if (!/^y(es)?$/i.test(answer.trim())) {
    return ok({ candidates: classified.data.candidates, errors: classified.data.errors, results: [] });
  }

  const removed = await removeStaleRegistryEntries(
    { registry: deps.registry, lock: deps.lock, registryResourceKey: deps.registryResourceKey },
    classified.data.candidates.map((candidate) => candidate.path),
  );
  if (!removed.ok) {
    return removed;
  }
  return ok({ candidates: classified.data.candidates, errors: classified.data.errors, results: removed.data.results });
}

export function assertUniqueSubcommandNames(subcommands: Subcommand[]): void {
  const seen = new Set<string>();
  for (const subcommand of subcommands) {
    if (seen.has(subcommand.name)) {
      throw new Error(`Duplicate subcommand name: ${subcommand.name}`);
    }
    seen.add(subcommand.name);
  }
}
