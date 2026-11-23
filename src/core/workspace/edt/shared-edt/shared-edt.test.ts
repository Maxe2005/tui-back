import { describe, expect, it } from 'vitest';
import {
  SHARED_EDT_ULID,
  SHARED_EDT_TOPIC,
  assertSharedEdtCanBeDisabled,
  buildSharedBranchesEdt,
  resolveActiveEdtPointer,
  isSharedEdtTopic,
  isSystemEdt,
} from './shared-edt.js';

describe('shared-edt', () => {
  it('uses a valid 26-char Crockford ulid', () => {
    expect(SHARED_EDT_ULID).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it('builds a system-shared entry with every repo on its manifest shared branch, in order', () => {
    const entry = buildSharedBranchesEdt([
      { repoPath: '/r/a', manifest: { service: 'a', sharedBranch: 'development' } },
      { repoPath: '/r/b', manifest: { service: 'b', sharedBranch: 'main' } },
    ]);
    expect(entry).toMatchObject({ ulid: SHARED_EDT_ULID, topic: SHARED_EDT_TOPIC, kind: 'system-shared' });
    expect(entry.members).toEqual([
      { service: 'a', repoPath: '/r/a', branch: 'development' },
      { service: 'b', repoPath: '/r/b', branch: 'main' },
    ]);
  });

  it('builds an empty-membership entry when no repo is managed', () => {
    expect(buildSharedBranchesEdt([]).members).toEqual([]);
  });

  it('recognizes the system EDT by kind, entry ulid or bare ulid, and nothing else', () => {
    const entry = buildSharedBranchesEdt([]);
    expect(isSystemEdt(entry)).toBe(true);
    expect(isSystemEdt({ ulid: SHARED_EDT_ULID })).toBe(true);
    expect(isSystemEdt(SHARED_EDT_ULID)).toBe(true);
    expect(isSystemEdt({ ulid: '01ABC', kind: undefined })).toBe(false);
    expect(isSystemEdt('01ABC')).toBe(false);
    expect(isSystemEdt(null)).toBe(false);
  });

  it('matches the reserved topic trimmed and case-insensitively', () => {
    expect(isSharedEdtTopic('  shared BRANCHES ')).toBe(true);
    expect(isSharedEdtTopic('Shared branch')).toBe(false);
  });
});

describe('settings guard and startup fallback', () => {
  it('refuses disabling while the system EDT is active, naming the switch to make first', () => {
    const refused = assertSharedEdtCanBeDisabled(SHARED_EDT_ULID);
    expect(refused).toMatchObject({ ok: false, error: { code: 'shared-edt-active' } });
    expect(!refused.ok && refused.error.message).toContain('switch to another EDT first');
  });

  it('allows disabling when another EDT, or none, is active', () => {
    expect(assertSharedEdtCanBeDisabled('01USER').ok).toBe(true);
    expect(assertSharedEdtCanBeDisabled(null).ok).toBe(true);
  });

  it('falls back to no active EDT with a warning when the pointer names the missing system EDT', () => {
    const resolved = resolveActiveEdtPointer(SHARED_EDT_ULID, [{ ulid: '01USER' }]);
    expect(resolved.active).toBeNull();
    expect(resolved.warning).toContain('Shared branches');
  });

  it('keeps the pointer when the system EDT exists, when it is another EDT, or when it is null', () => {
    expect(resolveActiveEdtPointer(SHARED_EDT_ULID, [{ ulid: SHARED_EDT_ULID }])).toEqual({ active: SHARED_EDT_ULID, warning: null });
    expect(resolveActiveEdtPointer('01GONE', [])).toEqual({ active: '01GONE', warning: null });
    expect(resolveActiveEdtPointer(null, [])).toEqual({ active: null, warning: null });
  });
});
