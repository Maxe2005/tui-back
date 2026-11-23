// The system "Shared branches" EDT is read-only: modify / rename / member edits / delete / a
// creation with its topic all fail `edt-system-readonly` before any write. Every port is a
// throwing proxy except the EDT list, so a single stray call fails the test.
import { describe, expect, it } from 'vitest';
import { ok } from '../../result.js';
import type { EdtRegistryEntry, EdtRegistryPort } from '../../ports/storage/edt-registry.js';
import { createEdt } from '../lifecycle/create.js';
import { deleteEdt } from '../lifecycle/delete.js';
import { addMemberUnderLock, modifyEdt } from '../lifecycle/modify.js';
import { buildSharedBranchesEdt } from './shared-edt.js';

const untouched = <T>(): T =>
  new Proxy({}, { get: (_t, key) => { throw new Error(`unexpected port call: ${String(key)}`); } }) as T;

const system = buildSharedBranchesEdt([{ repoPath: '/r/a', manifest: { service: 'a', sharedBranch: 'development' } }]);
const user: EdtRegistryEntry = { ulid: '01USER', topic: 'mine', createdAt: 'x', status: 'inactive', members: [] };

function listOnly(entries: EdtRegistryEntry[]): EdtRegistryPort {
  return new Proxy(
    { list: async () => ok(entries) },
    { get: (target, key) => { if (key in target) return (target as never)[key]; throw new Error(`unexpected edtRegistry call: ${String(key)}`); } },
  ) as unknown as EdtRegistryPort;
}

const base = () => ({
  edtRegistry: listOnly([system, user]),
  registry: untouched<never>(),
  manifest: untouched<never>(),
  git: untouched<never>(),
  lock: untouched<never>(),
  edtRegistryResourceKey: '/cfg/edts.yaml',
});

describe('edt-system-readonly guards', () => {
  const readonly = { ok: false, error: { code: 'edt-system-readonly' } };

  it.each([
    ['rename', { renameTo: 'other' }],
    ['add member', { addMembers: ['/r/b'], setBranches: [{ repoPath: '/r/b', branch: 'feat/x' }] }],
    ['remove member', { removeMembers: ['/r/a'] }],
    ['set branch', { setBranches: [{ repoPath: '/r/a', branch: 'feat/x' }] }],
  ])('modify refuses %s on the system EDT', async (_label, ops) => {
    const result = await modifyEdt({ ...base(), topic: 'Shared branches', addMembers: [], removeMembers: [], setBranches: [], ...ops });
    expect(result).toMatchObject(readonly);
  });

  it('modify refuses renaming a user EDT to the reserved topic', async () => {
    const result = await modifyEdt({ ...base(), topic: 'mine', addMembers: [], removeMembers: [], setBranches: [], renameTo: ' SHARED branches ' });
    expect(result).toMatchObject(readonly);
  });

  it('addMemberUnderLock (adopt path) refuses the system EDT', async () => {
    const result = await addMemberUnderLock({
      edtRegistry: untouched<never>(), lock: untouched<never>(), edtRegistryResourceKey: 'k', edt: system,
      member: { service: 'a', repoPath: '/r/a', branch: 'feat/x' },
    });
    expect(result).toMatchObject(readonly);
  });

  it('delete refuses the system EDT before reading state or touching git', async () => {
    const result = await deleteEdt({ ...base(), state: untouched<never>(), edtsBaseDir: '/nope', topic: 'Shared branches' });
    expect(result).toMatchObject(readonly);
  });

  it('create refuses a topic equal to the reserved one (trimmed, case-insensitive)', async () => {
    const result = await createEdt({
      ...base(), edtsBaseDir: '/nope', topic: '  shared BRANCHES ', members: ['/r/a'],
    } as never);
    expect(result).toMatchObject(readonly);
  });
});
