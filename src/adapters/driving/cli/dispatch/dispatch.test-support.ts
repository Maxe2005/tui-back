// Shared fakes for the CLI dispatch tests: lock/state/registry/git ports and a fully wired
// `buildTestSubcommands` registry that individual tests override port by port.
import { ok, err } from '../../../../core/result.js';
import type { ContainerPort } from '../../../../core/ports/runtime/container.js';
import type { DevAuthPort } from '../../../../core/ports/runtime/dev-auth.js';
import type { ManifestPort } from '../../../../core/ports/vcs/manifest.js';
import type { MigrationPort } from '../../../../core/ports/vcs/migration.js';
import type { RestartPort } from '../../../../core/ports/runtime/restart.js';
import type { RegistryPort } from '../../../../core/ports/storage/registry.js';
import type { EdtRegistryPort } from '../../../../core/ports/storage/edt-registry.js';
import type { GitPort } from '../../../../core/ports/vcs/git.js';
import type { LockPort } from '../../../../core/ports/runtime/lock.js';
import type { RouteScannerPort } from '../../../../core/ports/modules/route-scanner.js';
import type { SavedRequestPort } from '../../../../core/ports/storage/saved-request.js';
import { DEFAULT_SETTINGS } from '../../../../core/ports/storage/settings.js';
import type { StatePort } from '../../../../core/ports/storage/state.js';
import type { Subcommand } from './dispatch.js';
import type { DockerPort } from '../../../../core/ports/runtime/docker.js';
import { buildSubcommands } from '../subcommands.js';

export function fakeLock(): LockPort {
  return {
    acquire: async (resourceKey) => ok({ release: async () => ok(undefined) }),
    peek: async () => ok({ locked: false }),
  };
}

export function fakeState(): StatePort {
  return {
    readActiveEdt: async () => ok(null),
    writeActiveEdt: async () => ok(undefined),
    readSplitterRatios: async () => ok(null),
    writeSplitterRatios: async () => ok(undefined),
    readFilterHistory: async () => ok(null),
    writeFilterHistory: async () => ok(undefined),
    readCommandHistory: async () => ok(null),
    writeCommandHistory: async () => ok(undefined),
    readLogRules: async () => ok(null),
    writeLogRules: async () => ok(undefined),
    readLogRuleSets: async () => ok(null),
    writeLogRuleSets: async () => ok(undefined),
  };
}

export const fakeSubcommands: Subcommand[] = [
  { name: 'ping', usage: 'tui-back ping', run: async () => ok({ message: 'pong' }) },
  { name: 'fail', usage: 'tui-back fail', run: async () => err('fixture-failure', 'it failed on purpose') },
  {
    name: 'throws',
    usage: 'tui-back throws',
    run: async () => {
      throw new Error('boom');
    },
  },
];

export function fakeEdtRegistry(): EdtRegistryPort {
  return {
    add: async () => ok(undefined),
    list: async () => ok([]),
    setStatus: async () => ok(undefined),
    update: async () => ok(undefined),
    remove: async () => ok(undefined),
  };
}

export function fakeSavedRequests(): SavedRequestPort {
  return {
    save: async (request) => ok(request),
    overwrite: async (_name, request) => ok(request),
    get: async (name) => err('saved-request-not-found', `No saved request named "${name}"`),
    list: async () => ok([]),
    remove: async (name) => err('saved-request-not-found', `No saved request named "${name}"`),
  };
}

export function fakeGitPort(overrides: Partial<GitPort> = {}): GitPort {
  return {
    assertAllowedBranch: async () => ok(undefined),
    createBranch: async () => ok(undefined),
    deleteBranch: async () => ok(undefined),
    currentBranch: async () => ok('development'),
    aheadBehind: async () => ok({ ahead: 0, behind: 0 }),
    checkout: async () => ok(undefined),
    hasUncommittedChanges: async () => ok(false),
    stashSave: async () => ok(undefined),
    restoreStash: async () => ok(undefined),
    branchExistsLocally: async () => ok(true),
    fetch: async () => ok(undefined),
    pull: async () => ok(undefined),
    mergeBranch: async () => ok(undefined),
    abortMerge: async () => ok(undefined),
    isMergeInProgress: async () => ok(false),
    listDirtyPaths: async () => ok([]),
    discardPaths: async () => ok(undefined),
    discardAll: async () => ok(undefined),
    diffNameOnly: async () => ok([]),
    headRevision: async () => ok('head-a'),
    diffStat: async () => ok({ files: 0, insertions: 0, deletions: 0 }),
    discardPathsToHead: async () => ok(undefined),
    isRebaseInProgress: async () => ok(false),
    hasUnmergedPaths: async () => ok(false),
    listUnmergedPaths: async () => ok([] as string[]),
    readWorktreeFile: async () => ok(""),
    writeResolvedFile: async () => ok(undefined),
    checkoutSide: async () => ok(undefined),
    finalizeMerge: async () => ok(undefined),
    listBranches: async () => ok([]),
    renameBranch: async () => ok(undefined),
    listRemoteBranches: async () => ok([]),
    createTrackingBranch: async () => ok(undefined),
    stagePaths: async () => ok(undefined),
    commit: async () => ok(undefined),
    isBranchMerged: async () => ok(true),
    hasStash: async () => ok(false),
    fetchRemote: async () => ok(undefined),
    listUnpushedCommits: async () => ok([] as string[]),
    listVersionBumpCommits: async () => ok({ endedBy: "exhausted" as const, scanned: 0 }),
    listBranchesContaining: async () => ok([] as string[]),
    ...overrides,
  };
}

export function buildTestSubcommands(overrides: Partial<Parameters<typeof buildSubcommands>[0]> = {}) {
  const registry: RegistryPort = {
    list: async () => ok([]),
    add: async () => ok(undefined),
    exists: async () => ok(false),
    scan: async () => ok({ candidates: [], skipped: [] }),
    reset: async () => ok({ path: '/p', backupPath: null }),
    remove: async () => ok(undefined),
  };
  const manifest: ManifestPort = { load: async () => err('manifest-not-found', 'none') };
  const container: ContainerPort = { restart: async () => ok(undefined) };
  const migration: MigrationPort = { run: async () => ok({ output: '' }) };
  const restart: RestartPort = { run: async () => ok({ output: '' }) };
  const scanner: RouteScannerPort = { scan: async () => ok([]) };
  const auth: DevAuthPort = { getSession: async () => ok({ cookie: 'sid=abc' }) };
  const git: GitPort = fakeGitPort();

  return buildSubcommands({
    registry,
    manifest,
    manifestCarry: { capture: async () => ({ ok: true, data: { kind: 'absent' } }), restore: async () => ({ ok: true, data: undefined }) },
    lock: fakeLock(),
    registryResourceKey: '/cfg/registry.yaml',
    edtsBaseDir: '/data/edts',
    edtRegistry: fakeEdtRegistry(),
    edtRegistryResourceKey: '/cfg/edts.yaml',
    git,
    container,
    docker: { getContainerHealth: async () => ok('up' as const) } as unknown as DockerPort,
    migration,
    restart,
    state: fakeState(),
    settings: { load: async () => ok({ settings: DEFAULT_SETTINGS, warning: null }), save: async () => ok(undefined) },
    scanner,
    auth,
    savedRequests: fakeSavedRequests(),
    install: {
      installer: {
        repositoryUrl: async () => null,
        npmGlobal: async () => ({ ok: true as const }),
        readFile: async () => null,
        writeFile: async () => undefined,
        removeFile: async () => false,
      },
      nodeVersion: 'v24.0.0',
      env: {},
      homedir: '/home/test',
      dataDir: '/data',
    },
    ...overrides,
  });
}
