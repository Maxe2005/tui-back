// adapters/driven/git gate: integration tests against real temp git repos; child_process is not
// mocked. The gate firing "before any git" is checked two ways: a protected target that does
// not exist stays absent, and a manifest-only directory that is NOT a git repository still
// gets the gate error rather than a "not a git repository" failure.

import { afterEach, describe, expect, it } from 'vitest';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ok } from '../../../core/result.js';
import type { EdtRegistryPort } from '../../../core/ports/edt-registry.js';
import { assertAllowedBranch } from './index.js';
import { makeGitRepo, makeDirWithManifestOnly, manifest, fakeEdtRegistry, edtEntry, cleanupTmpDirs } from './git.test-support.js';

afterEach(cleanupTmpDirs);

describe('assertAllowedBranch', () => {
  it('rejects every manifest-protected branch and the sharedBranch without any git invocation', async () => {
    const repo = await makeDirWithManifestOnly();

    for (const shared of ['development', 'preprod', 'prod']) {
      const result = await assertAllowedBranch(manifest, repo, shared);
      expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
    }
  });

  it("names the branch and the service's manifest in the rejection", async () => {
    const repo = await makeGitRepo();

    const result = await assertAllowedBranch(manifest, repo, 'preprod');

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'shared-branch-rejected', message: `Branch "preprod" is protected by route-explorer's manifest (repo ${repo})` },
    });
  });

  it('allows a formerly implicit branch when the manifest does not list it', async () => {
    const repo = await makeGitRepo('main', null);

    for (const formerlyImplicit of ['development', 'preprod', 'prod']) {
      expect(await assertAllowedBranch(manifest, repo, formerlyImplicit)).toEqual({ ok: true, data: undefined });
    }
    expect(await assertAllowedBranch(manifest, repo, 'main')).toMatchObject({
      ok: false,
      error: { code: 'shared-branch-rejected' },
    });
  });

  it('allows prod with no protectedBranches line and the default development sharedBranch', async () => {
    const repo = await makeGitRepo(undefined, null);

    expect(await assertAllowedBranch(manifest, repo, 'prod')).toEqual({ ok: true, data: undefined });
    expect(await assertAllowedBranch(manifest, repo, 'development')).toMatchObject({
      ok: false,
      error: { code: 'shared-branch-rejected' },
    });
  });

  it('rejects a branch name equal to the repo manifest sharedBranch', async () => {
    const repo = await makeGitRepo('staging');

    const result = await assertAllowedBranch(manifest, repo, 'staging');

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('passes an ordinary branch name (not in the shared set)', async () => {
    const repo = await makeGitRepo();

    const result = await assertAllowedBranch(manifest, repo, 'feat/ordinary');

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('propagates a manifest load failure from the gate (sharedBranch cannot be resolved)', async () => {
    const repo = await makeGitRepo();
    await rm(join(repo, '.tui-back.yaml'), { force: true });

    const result = await assertAllowedBranch(manifest, repo, 'feat/x');

    expect(result).toMatchObject({ ok: false, error: { code: 'manifest-not-found' } });
  });
});

describe('assertAllowedBranch — cross-EDT gate (AD-8)', () => {
  it('rejects a branch already registered as a different EDT\'s own branch for this repo', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', repo, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
  });

  it('passes when the branch is registered as the SAME edtId\'s own branch', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-mine', repo, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('passes when no other EDT has registered this branch for this repo', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', repo, 'feat/unrelated')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/mine', 'edt-mine', edtRegistry);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('ignores a same-name branch registered by another EDT for a DIFFERENT repo', async () => {
    const repo = await makeGitRepo();
    const otherRepo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', otherRepo, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('detects a conflict even when the registry\'s stored repoPath differs in formatting (trailing slash)', async () => {
    const repo = await makeGitRepo();
    // Same repo, unresolved trailing-slash form — as if it were stored at EDT-creation time
    // in a shape that doesn't byte-match the caller's already-resolve()'d repoPath.
    const edtRegistry = fakeEdtRegistry([edtEntry('edt-other', `${repo}/`, 'feat/shared-name')]);

    const result = await assertAllowedBranch(manifest, repo, 'feat/shared-name', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'branch-owned-by-other-edt' } });
  });

  it('skips the cross-EDT check entirely when edtId/edtRegistry are omitted (shared-branch gate only)', async () => {
    const repo = await makeGitRepo();

    const result = await assertAllowedBranch(manifest, repo, 'feat/ordinary');

    expect(result).toEqual({ ok: true, data: undefined });
  });

  it('still rejects a shared branch even when edtId/edtRegistry are supplied', async () => {
    const repo = await makeGitRepo();
    const edtRegistry = fakeEdtRegistry([]);

    const result = await assertAllowedBranch(manifest, repo, 'development', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'shared-branch-rejected' } });
  });

  it('propagates an edtRegistry.list() failure', async () => {
    const repo = await makeGitRepo();
    const edtRegistry: EdtRegistryPort = {
      add: async () => ok(undefined),
      list: async () => ({ ok: false, error: { code: 'edt-registry-invalid-format', message: 'bad shape' } }),
      setStatus: async () => ok(undefined),
      update: async () => ok(undefined),
      remove: async () => ok(undefined),
    };

    const result = await assertAllowedBranch(manifest, repo, 'feat/x', 'edt-mine', edtRegistry);

    expect(result).toMatchObject({ ok: false, error: { code: 'edt-registry-invalid-format' } });
  });
});
