// Shared builders for the group-update tests: the active EDT fixture, the per-module git fake
// and the params factory.
import { vi } from 'vitest';
import { ok } from '../../result.js';
import type { GitPort } from '../../ports/git.js';
import {
  edtEntry,
  fakeContainer,
  fakeEdtRegistry,
  fakeGit as fakeCoreGit,
  fakeLock,
  fakeManifest,
  fakeMigration,
  fakeRestart,
  fakeState,
  member,
} from '../../shared/core-ports.test-support.js';
import type { GroupUpdateParams } from './group-update.js';

export function fakeGit(overrides: Partial<GitPort> = {}): GitPort {
  return fakeCoreGit({
    // Matches ACTIVE's own recorded branches per repo — anything else exercises the
    // `unexpected-branch` row, never a silent merge into the wrong branch.
    currentBranch: vi.fn(async (repoPath: string) => ok(repoPath === '/repo/b' ? 'feat/b' : 'feat/a')),
    ...overrides,
  });
}


export const ACTIVE = edtEntry('edt-active', 'demo', [
  member('svc-a', '/repo/a', 'feat/a'),
  member('svc-b', '/repo/b', 'feat/b'),
]);

export function makeParams(overrides: Partial<GroupUpdateParams> = {}): GroupUpdateParams {
  return {
    edtRegistry: overrides.edtRegistry ?? fakeEdtRegistry({ list: vi.fn(async () => ok([ACTIVE])) }),
    state: overrides.state ?? fakeState({ readActiveEdt: vi.fn(async () => ok('edt-active')) }),
    manifest: overrides.manifest ?? fakeManifest(),
    git: overrides.git ?? fakeGit(),
    container: overrides.container ?? fakeContainer(),
    migration: overrides.migration ?? fakeMigration(),
    restart: overrides.restart ?? fakeRestart(),
    lock: overrides.lock ?? fakeLock(),
    ...(overrides.registry !== undefined ? { registry: overrides.registry } : {}),
    ...(overrides.scope !== undefined ? { scope: overrides.scope } : {}),
    ...(overrides.onUpdateBlocker !== undefined ? { onUpdateBlocker: overrides.onUpdateBlocker } : {}),
    ...(overrides.selection !== undefined ? { selection: overrides.selection } : {}),
    ...(overrides.runMigrations !== undefined ? { runMigrations: overrides.runMigrations } : {}),
    ...(overrides.cleanRestart !== undefined ? { cleanRestart: overrides.cleanRestart } : {}),
    ...(overrides.onPhase !== undefined ? { onPhase: overrides.onPhase } : {}),
    ...(overrides.shouldCancel !== undefined ? { shouldCancel: overrides.shouldCancel } : {}),
    ...(overrides.onServiceResult !== undefined ? { onServiceResult: overrides.onServiceResult } : {}),
    ...(overrides.concurrency !== undefined ? { concurrency: overrides.concurrency } : {}),
    ...(overrides.ordering !== undefined ? { ordering: overrides.ordering } : {}),
    ...(overrides.afterStage !== undefined ? { afterStage: overrides.afterStage } : {}),
    ...(overrides.autoResolveConflict !== undefined ? { autoResolveConflict: overrides.autoResolveConflict } : {}),
  };
}
