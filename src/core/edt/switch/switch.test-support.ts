// Shared builders for the switch tests: manifest naming, the carry port fake, the EDT fixtures,
// the params factory and the zero-write / call-order assertions.
import { expect, vi, type Mock } from 'vitest';
import { ok } from '../../result.js';
import type { GitPort } from '../../ports/vcs/git.js';
import type { Manifest, ManifestPort } from '../../ports/vcs/manifest.js';
import type { ManifestCarryPort } from '../../ports/vcs/manifest-carry.js';
import {
  calls,
  edtEntry,
  fakeEdtRegistry,
  fakeGit as baseFakeGit,
  fakeLock,
  fakeManifest as fakeCoreManifest,
  fakeRegistry,
  fakeState,
  manifestFor as coreManifestFor,
  member,
} from '../../shared/core-ports.test-support.js';
import type { SwitchActiveEdtParams } from './switch.js';

// The shared fake sits on `development`; switch tests need repos NOT already on their target so a
// plain switch is `switched` (the `unchanged` outcome has its own describe).
export function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return baseFakeGit({ currentBranch: vi.fn(async () => ok('wip/elsewhere')), ...overrides });
}

export function manifestFor(repoPath: string): Manifest {
  const name = repoPath.split('/').pop() ?? repoPath;
  return coreManifestFor(`svc-${name}`, `ctr-${name}`);
}

export function fakeManifest(overrides: Partial<ManifestPort> = {}): ManifestPort {
  return fakeCoreManifest(overrides, manifestFor);
}

export function fakeManifestCarry(overrides: Partial<ManifestCarryPort> = {}): ManifestCarryPort {
  return {
    capture: vi.fn(async () => ok({ kind: 'absent' } as const)),
    restore: vi.fn(async () => ok(undefined)),
    ...overrides,
  };
}

export const TARGET = edtEntry('target-ulid', 'target-topic', [member('svc-a', '/repo/a', 'feat/a')]);
export const OUTGOING = edtEntry('outgoing-ulid', 'outgoing-topic', [member('svc-c', '/repo/c', 'feat/c')]);
export const REPOS = ['/repo/a', '/repo/b', '/repo/c'];

export function makeParams(overrides: Partial<SwitchActiveEdtParams> = {}): SwitchActiveEdtParams {
  return {
    edtRegistry: overrides.edtRegistry ?? fakeEdtRegistry({ list: vi.fn(async () => ok([TARGET, OUTGOING])) }),
    registry: overrides.registry ?? fakeRegistry(REPOS),
    manifest: overrides.manifest ?? fakeManifest(),
    manifestCarry: overrides.manifestCarry ?? fakeManifestCarry(),
    git: overrides.git ?? fakeGit(),
    lock: overrides.lock ?? fakeLock(),
    state: overrides.state ?? fakeState({ readActiveEdt: vi.fn(async () => ok('outgoing-ulid')) }),
    edtRegistryResourceKey: overrides.edtRegistryResourceKey ?? '/cfg/edts.yaml',
    topic: overrides.topic ?? 'target-topic',
    force: overrides.force,
    dirtyResolutions: overrides.dirtyResolutions,
    dirtyPolicy: overrides.dirtyPolicy,
    onDirtyReposBeforeSwitch: overrides.onDirtyReposBeforeSwitch,
  };
}

export const WRITE_METHODS = ['stashSave', 'restoreStash', 'checkout', 'createBranch', 'deleteBranch', 'discardAll', 'discardPaths', 'fetch', 'renameBranch'] as const;

export function expectZeroWrites(git: GitPort): void {
  for (const method of WRITE_METHODS) {
    expect(calls(git[method]), `git.${method}`).toHaveLength(0);
  }
}

export function callOrder(fn: unknown, predicate: (args: unknown[]) => boolean = () => true): number {
  const mock = fn as Mock;
  const index = mock.mock.calls.findIndex((args) => predicate(args));
  return mock.mock.invocationCallOrder[index] as number;
}

export const OTHER = edtEntry('other-ulid', 'other-topic', [member('svc-b', '/repo/b', 'feat/b-other')], 'inactive');
