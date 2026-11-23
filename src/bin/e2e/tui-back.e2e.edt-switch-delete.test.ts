import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { lockPathFor } from '../../adapters/driven/lock/helpers.js';
import { runCli, makeTempDir, makeGitRepo, commitManifest, runGit, branchExists, cleanupTmpDirs } from './e2e.test-support.js';

afterEach(cleanupTmpDirs);

describe('tui-back edt switch (black-box)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  async function registerRepos(repos: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (const repo of repos) {
      expect(runCli(['register', repo], env).status).toBe(0);
    }
  }

  // makeGitRepo() (module-level) leaves .tui-back.yaml untracked (written before `git init`,
  // never added), so a fresh repo is never actually clean — irrelevant to edt-create's own
  // tests, but it would make every repo here look "dirty" from the moment it's registered,
  // confounding this describe's dirty/clean assertions. This variant commits everything
  // first for a truly clean starting point.
  async function makeCleanGitRepo(): Promise<string> {
    const dir = await makeGitRepo();
    runGit(dir, ['add', '.tui-back.yaml']);
    const commit = runGit(dir, ['commit', '-m', 'add manifest']);
    if (commit.status !== 0) {
      throw new Error(`git commit failed: ${commit.stderr}`);
    }
    return dir;
  }

  async function readEdtsYaml(xdg: string): Promise<{ edts: Array<{ ulid: string; topic: string; status: string }> }> {
    return parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
  }

  async function readStateJson(xdg: string): Promise<{ activeEdt: string | null }> {
    return JSON.parse(await readFile(join(xdg, 'tui-back', 'state.json'), 'utf8'));
  }

  it('fails upfront with edt-not-found for an unregistered topic, touching no repo', async () => {
    const xdg = await makeTempDir();
    const { status, stdout } = runCli(['edt', 'switch', '--to', 'no-such-topic'], createEnv(xdg));

    expect(status).toBe(1);
    const parsed = JSON.parse(stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('edt-not-found');
    await expect(access(join(xdg, 'tui-back', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it(
    'round-trips uncommitted work across a switch: an outgoing member (state 1) is stashed under the outgoing tag, ' +
      'lands clean on its shared branch, and pops back onto its own branch when switching back',
    async () => {
      const xdg = await makeTempDir();
      const env = createEnv(xdg);
      const r1 = await makeCleanGitRepo();
      const r2 = await makeCleanGitRepo();
      await registerRepos([r1, r2], env);

      const createA = runCli(
        ['edt', 'create', '--topic', 'a', '--member', r1, '--create-branches', '--branch-name', 'feat/r1'],
        env,
      );
      expect(createA.status).toBe(0);
      const ulidA = JSON.parse(createA.stdout.trim()).data.ulid;

      const createB = runCli(
        ['edt', 'create', '--topic', 'b', '--member', r2, '--create-branches', '--branch-name', 'feat/r2'],
        env,
      );
      expect(createB.status).toBe(0);
      const ulidB = JSON.parse(createB.stdout.trim()).data.ulid;

      // First-ever switch: no outgoing EDT yet. r1 (a's member) moves onto its own branch;
      // r2 (not a member of a) stays on the shared branch (already there).
      const switchToA = runCli(['edt', 'switch', '--to', 'a'], env);
      expect(switchToA.status).toBe(0);
      expect(JSON.parse(switchToA.stdout.trim()).data).toMatchObject({
        ulid: ulidA,
        // r1 (a's member) checks into feat/r1; r2 (registered, but not a's member) is forced
        // onto the shared branch too — it is already there, so its row is `unchanged`.
        results: [
          { service: 'route-explorer', outcome: 'switched' },
          { service: 'route-explorer', outcome: 'unchanged' },
        ],
        wasInterrupted: false,
      });
      expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/r1');
      expect((await readStateJson(xdg)).activeEdt).toBe(ulidA);

      // Dirty r1's working tree while "a" is active and r1 sits on feat/r1.
      await writeFile(join(r1, 'wip.txt'), 'uncommitted work');

      // Switch a -> b: r1 is a's member (state 1) and not b's, so its work is stashed under
      // `tui-back:<a>` for a's return and r1 lands clean on the shared branch; r2 (b's
      // member) checks into its own branch.
      const switchToB = runCli(['edt', 'switch', '--to', 'b'], env);

      expect(switchToB.status).toBe(0);
      const dataB = JSON.parse(switchToB.stdout.trim()).data;
      expect(dataB).toMatchObject({
        ulid: ulidB,
        results: [
          { service: 'route-explorer', outcome: 'switched' },
          { service: 'route-explorer', outcome: 'switched' },
        ],
        wasInterrupted: false,
      });

      // r1: on the shared branch, clean — the work never leaks out of its EDT.
      expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
      expect(runGit(r1, ['status', '--porcelain']).stdout.trim()).toBe('');
      expect(runGit(r1, ['stash', 'list']).stdout.trim()).toContain(`tui-back:${ulidA}`);

      // r2: checked into its own branch (b's).
      expect(runGit(r2, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/r2');

      // state.json + edts.yaml both reflect exactly one active EDT (AD-10).
      expect((await readStateJson(xdg)).activeEdt).toBe(ulidB);
      const edtsAfterB = await readEdtsYaml(xdg);
      expect(edtsAfterB.edts.find((e) => e.ulid === ulidA)?.status).toBe('inactive');
      expect(edtsAfterB.edts.find((e) => e.ulid === ulidB)?.status).toBe('active');

      // Switching to the already-active EDT is a no-op success (FR-1).
      const noop = runCli(['edt', 'switch', '--to', 'b'], env);
      expect(noop.status).toBe(0);
      expect(JSON.parse(noop.stdout.trim()).data).toEqual({
        ulid: ulidB,
        topic: 'b',
        results: [],
        wasInterrupted: false,
      });

      // Switch back b -> a: r1 is a's member again and its a-tagged stash pops onto feat/r1.
      const switchBackToA = runCli(['edt', 'switch', '--to', 'a'], env);
      expect(switchBackToA.status).toBe(0);
      expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('feat/r1');
      expect(await readFile(join(r1, 'wip.txt'), 'utf8')).toBe('uncommitted work');
      expect(runGit(r1, ['stash', 'list']).stdout.trim()).toBe('');
    },
  );

  it('fails safe on a dirty non-member: exits non-zero with switch-dirty-services-unresolved, touching nothing', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const r1 = await makeCleanGitRepo();
    const r2 = await makeCleanGitRepo();
    await registerRepos([r1, r2], env);

    const createA = runCli(
      ['edt', 'create', '--topic', 'a', '--member', r1, '--create-branches', '--branch-name', 'feat/r1'],
      env,
    );
    expect(createA.status).toBe(0);
    const edtsBefore = await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8');

    // r2 belongs to no EDT: its uncommitted work may only move under an explicit resolution.
    await writeFile(join(r2, 'orphan.txt'), 'nobody owns this');

    const switched = runCli(['edt', 'switch', '--to', 'a'], env);

    expect(switched.status).not.toBe(0);
    const parsed = JSON.parse(switched.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('switch-dirty-services-unresolved');
    expect(parsed.error.details).toEqual([
      { service: 'route-explorer', repoPath: expect.stringContaining(r2.split('/').pop() as string), scope: 'non-member', currentBranch: 'development' },
    ]);

    // Zero repos touched, state.json/edts.yaml untouched.
    expect(runGit(r1, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim()).toBe('development');
    expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toContain('orphan.txt');
    expect(runGit(r2, ['stash', 'list']).stdout.trim()).toBe('');
    await expect(access(join(xdg, 'tui-back', 'state.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8')).toBe(edtsBefore);
  });

  describe('dirty flags', () => {
    async function dirtyNonMemberSetup() {
      const xdg = await makeTempDir();
      const env = createEnv(xdg);
      const r1 = await makeCleanGitRepo();
      const r2 = await makeCleanGitRepo();
      await registerRepos([r1, r2], env);
      const created = runCli(
        ['edt', 'create', '--topic', 'a', '--member', r1, '--create-branches', '--branch-name', 'feat/r1'],
        env,
      );
      expect(created.status).toBe(0);
      await writeFile(join(r2, 'orphan.txt'), 'nobody owns this');
      return { xdg, env, r1, r2 };
    }

    it('--discard-dirty discards the non-member work and lists the paths in detail.discardedPaths', async () => {
      const { env, r2 } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--discard-dirty'], env);

      expect(switched.status).toBe(0);
      const parsed = JSON.parse(switched.stdout.trim());
      expect(parsed.ok).toBe(true);
      const row = parsed.data.results.find((r: { outcome: string }) => r.outcome === 'discarded');
      expect(row.detail.discardedPaths).toEqual(['orphan.txt']);
      expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toBe('');
    });

    it('--adopt-dirty without --adopt-branch on a shared branch fails with missing-argument, zero writes', async () => {
      const { env, r2 } = await dirtyNonMemberSetup();
      const r3 = await makeCleanGitRepo();
      await registerRepos([r3], env);
      expect(runCli(['edt', 'switch', '--to', 'a', '--discard-dirty'], env).status).toBe(0);
      expect(runCli(['edt', 'create', '--topic', 'b', '--member', r3, '--create-branches', '--branch-name', 'feat/r3'], env).status).toBe(0);
      await writeFile(join(r2, 'orphan2.txt'), 'rescue me');

      const switched = runCli(['edt', 'switch', '--to', 'b', '--adopt-dirty'], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('missing-argument');
      expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toContain('orphan2.txt');
    });

    it('--adopt-dirty without --adopt-branch and no outgoing EDT reports switch-adopt-without-outgoing', async () => {
      const { env } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--adopt-dirty'], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('switch-adopt-without-outgoing');
    });

    it.each([
      ['--adopt-branch alone', ['--adopt-branch', 'x']],
      ['--adopt-branch with --discard-dirty', ['--discard-dirty', '--adopt-branch', 'x']],
      ['an empty --adopt-branch', ['--adopt-dirty', '--adopt-branch', '']],
      ['a repeated --adopt-branch', ['--adopt-dirty', '--adopt-branch', 'x', '--adopt-branch', 'y']],
      ['a trailing --adopt-branch', ['--adopt-dirty', '--adopt-branch']],
      ['a flag as the --adopt-branch value', ['--adopt-dirty', '--adopt-branch', '--force']],
    ])('rejects %s with invalid-argument, zero writes', async (_label, flags) => {
      const { env, r2 } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', ...flags], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('invalid-argument');
      expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toContain('orphan.txt');
    });

    it('--adopt-dirty --adopt-branch adopts onto a new branch, never checking out the work away', async () => {
      const { env, r2 } = await dirtyNonMemberSetup();
      // Outgoing EDT needed: activate a first, then adopt into it while switching to b.
      const r3 = await makeCleanGitRepo();
      await registerRepos([r3], env);
      expect(runCli(['edt', 'switch', '--to', 'a', '--discard-dirty'], env).status).toBe(0);
      expect(runCli(['edt', 'create', '--topic', 'b', '--member', r3, '--create-branches', '--branch-name', 'feat/r3'], env).status).toBe(0);
      await writeFile(join(r2, 'orphan2.txt'), 'rescue me');

      const switched = runCli(['edt', 'switch', '--to', 'b', '--adopt-dirty', '--adopt-branch', 'feat/rescue'], env);

      expect(switched.status).toBe(0);
      const parsed = JSON.parse(switched.stdout.trim());
      expect(parsed.data.results).toContainEqual(
        expect.objectContaining({ outcome: 'adopted', detail: expect.objectContaining({ adoptedBranch: 'feat/rescue' }) }),
      );
      expect(runGit(r2, ['branch', '--list', 'feat/rescue']).stdout).toContain('feat/rescue');
    });

    it('--adopt-dirty with --discard-dirty is invalid-argument, zero writes', async () => {
      const { env, r2 } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--adopt-dirty', '--discard-dirty'], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('invalid-argument');
      expect(runGit(r2, ['status', '--porcelain']).stdout.trim()).toContain('orphan.txt');
    });

    it('--adopt-dirty with no outgoing EDT fails with switch-adopt-without-outgoing', async () => {
      const { env } = await dirtyNonMemberSetup();

      const switched = runCli(['edt', 'switch', '--to', 'a', '--adopt-dirty', '--adopt-branch', 'feat/x'], env);

      expect(switched.status).not.toBe(0);
      expect(JSON.parse(switched.stdout.trim()).error.code).toBe('switch-adopt-without-outgoing');
    });
  });

  it('a target member whose own branch is missing locally is `failed` in data.results, never a thrown error', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeCleanGitRepo();
    await registerRepos([repo], env);

    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);
    // Simulate the branch having gone missing locally after registration (e.g. manually
    // deleted) — the registry still records it as this member's own branch.
    expect(runGit(repo, ['branch', '-D', 'feat/demo']).status).toBe(0);

    const switched = runCli(['edt', 'switch', '--to', 'demo'], env);

    expect(switched.status).toBe(0);
    const data = JSON.parse(switched.stdout.trim()).data;
    expect(data.results).toEqual([
      expect.objectContaining({ service: 'route-explorer', outcome: 'failed' }),
    ]);
    // state.json is still updated despite the per-repo failure (independent of repo outcomes).
    expect((await readStateJson(xdg)).activeEdt).toBe(data.ulid);
  });

  it(
    "rejects a target member whose branch is already registered as a different, still-registered EDT's own " +
      'branch for the same repo (AD-8 cross-EDT gate)',
    async () => {
      const xdg = await makeTempDir();
      const env = createEnv(xdg);
      const repo = await makeCleanGitRepo();
      await registerRepos([repo], env);

      // EDT "a" claims repo on feat/shared. Branch creation only creates the ref, never
      // checks the working tree out to it — the repo stays on `development` after this.
      const createA = runCli(
        ['edt', 'create', '--topic', 'a', '--member', repo, '--create-branches', '--branch-name', 'feat/shared'],
        env,
      );
      expect(createA.status).toBe(0);
      expect(runGit(repo, ['checkout', 'feat/shared']).status).toBe(0);

      // EDT "b" is created without --create-branches: the repo's current branch is now
      // feat/shared, and create.ts's branch-creation-disabled path has no edtId to
      // re-verify against — so "b" registers the very same repo+branch as its own, too.
      // This reproduces the ambiguous-ownership state the cross-EDT gate exists to catch at
      // switch time, since `assertAllowedBranch` is only ever re-verified (with an edtId)
      // inside switchActiveEdt, never at creation.
      const createB = runCli(['edt', 'create', '--topic', 'b', '--member', repo], env);
      expect(createB.status).toBe(0);
      expect(JSON.parse(createB.stdout.trim()).data.results).toEqual([
        expect.objectContaining({ outcome: 'existing-branch' }),
      ]);

      // main.ts's composition-root wiring (createGitPort(manifest, edtRegistry)) is what
      // makes this rejection real through the actual CLI binary — a regression there would
      // let this switch through undetected by any unit test, since those construct their own
      // EdtRegistryPort/GitPort directly rather than going through main.ts.
      const switched = runCli(['edt', 'switch', '--to', 'b'], env);

      expect(switched.status).toBe(0);
      const data = JSON.parse(switched.stdout.trim()).data;
      expect(data.results).toEqual([
        expect.objectContaining({
          service: 'route-explorer',
          outcome: 'failed',
          detail: expect.objectContaining({ code: 'branch-owned-by-other-edt' }),
        }),
      ]);
    },
  );

  it('blocks by default on a held outgoing lock; --force proceeds and marks it interrupted; returning reports wasInterrupted', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const r1 = await makeCleanGitRepo();
    const r2 = await makeCleanGitRepo();
    await registerRepos([r1, r2], env);

    const createA = runCli(['edt', 'create', '--topic', 'a', '--member', r1], env);
    expect(createA.status).toBe(0);
    const ulidA = JSON.parse(createA.stdout.trim()).data.ulid;
    const createB = runCli(['edt', 'create', '--topic', 'b', '--member', r2], env);
    expect(createB.status).toBe(0);

    expect(runCli(['edt', 'switch', '--to', 'a'], env).status).toBe(0);

    // Simulate an in-progress action holding edt:<ulidA>'s lock (constructed directly: a real
    // action finishes too fast to race black-box).
    const lockDir = join(xdg, 'tui-back', 'locks');
    const lockPath = lockPathFor(lockDir, `edt:${ulidA}`);
    await mkdir(lockPath, { recursive: true });
    await writeFile(join(lockPath, 'owner.json'), JSON.stringify({ pid: process.pid, timestamp: Date.now() }), 'utf8');

    const blocked = runCli(['edt', 'switch', '--to', 'b'], env);
    expect(blocked.status).toBe(1);
    const blockedParsed = JSON.parse(blocked.stdout.trim());
    expect(blockedParsed.ok).toBe(false);
    expect(blockedParsed.error.code).toBe('switch-blocked-action-in-progress');
    expect((await readStateJson(xdg)).activeEdt).toBe(ulidA);

    const forced = runCli(['edt', 'switch', '--to', 'b', '--force'], env);
    expect(forced.status).toBe(0);
    expect((await readStateJson(xdg)).activeEdt).not.toBe(ulidA);
    const edtsAfterForce = await readEdtsYaml(xdg);
    expect(edtsAfterForce.edts.find((e) => e.ulid === ulidA)?.status).toBe('interrupted');

    const backToA = runCli(['edt', 'switch', '--to', 'a'], env);
    expect(backToA.status).toBe(0);
    const backToAData = JSON.parse(backToA.stdout.trim()).data;
    expect(backToAData.wasInterrupted).toBe(true);
    const edtsAfterReturn = await readEdtsYaml(xdg);
    expect(edtsAfterReturn.edts.find((e) => e.ulid === ulidA)?.status).toBe('active');
  });
});

describe('tui-back edt delete (black-box)', () => {
  function createEnv(xdg: string) {
    return { XDG_CONFIG_HOME: xdg, XDG_DATA_HOME: xdg, XDG_STATE_HOME: xdg };
  }

  async function registerRepos(repos: string[], env: NodeJS.ProcessEnv): Promise<void> {
    for (const repo of repos) {
      expect(runCli(['register', repo], env).status).toBe(0);
    }
  }

  async function readEdtsYaml(xdg: string): Promise<{ edts: Array<{ ulid: string; topic: string; status: string }> }> {
    return parse(await readFile(join(xdg, 'tui-back', 'edts.yaml'), 'utf8'));
  }

  it('fails upfront with edt-not-found for an unregistered topic, touching no repo', async () => {
    const xdg = await makeTempDir();

    const result = runCli(['edt', 'delete', 'no-such-topic'], createEnv(xdg));

    expect(result.status).toBe(1);
    const parsed = JSON.parse(result.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('edt-not-found');
  });

  it('rejects deleting the active EDT, never touching a member branch or the registry entry', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeGitRepo();
    // A first-ever switch refuses a dirty target member without a resolution, so the untracked
    // manifest makeGitRepo() leaves behind is committed first.
    commitManifest(repo);
    await registerRepos([repo], env);
    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);
    expect(runCli(['edt', 'switch', '--to', 'demo'], env).status).toBe(0);

    const deleted = runCli(['edt', 'delete', 'demo'], env);

    expect(deleted.status).toBe(1);
    const parsed = JSON.parse(deleted.stdout.trim());
    expect(parsed.ok).toBe(false);
    expect(parsed.error.code).toBe('edt-delete-active-rejected');
    expect(branchExists(repo, 'feat/demo')).toBe(true);
    expect((await readEdtsYaml(xdg)).edts.some((e) => e.topic === 'demo')).toBe(true);
  });

  it('deletes the EDT record and its SQLite file, leaving a member branch untouched by default', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeGitRepo();
    await registerRepos([repo], env);
    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);
    const ulid = JSON.parse(created.stdout.trim()).data.ulid;

    const deleted = runCli(['edt', 'delete', 'demo'], env);

    expect(deleted.status).toBe(0);
    const parsed = JSON.parse(deleted.stdout.trim());
    expect(parsed.data).toMatchObject({ ulid, topic: 'demo', results: [{ outcome: 'left' }] });
    expect((await readEdtsYaml(xdg)).edts.some((e) => e.topic === 'demo')).toBe(false);
    await expect(access(join(xdg, 'tui-back', 'edts', `${ulid}.db`))).rejects.toMatchObject({ code: 'ENOENT' });
    // Omitting --branches for the member leaves its branch untouched.
    expect(branchExists(repo, 'feat/demo')).toBe(true);
  });

  it('deletes a member branch when --branches <repoPath>=delete is passed', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);
    const repo = await makeGitRepo();
    await registerRepos([repo], env);
    const created = runCli(
      ['edt', 'create', '--topic', 'demo', '--member', repo, '--create-branches', '--branch-name', 'feat/demo'],
      env,
    );
    expect(created.status).toBe(0);

    const deleted = runCli(['edt', 'delete', 'demo', '--branches', `${repo}=delete`], env);

    expect(deleted.status).toBe(0);
    const parsed = JSON.parse(deleted.stdout.trim());
    expect(parsed.data.results).toEqual([{ service: 'route-explorer', outcome: 'deleted' }]);
    expect(branchExists(repo, 'feat/demo')).toBe(false);
  });

  it('reports invalid-argument for a missing topic or a malformed --branches value', async () => {
    const xdg = await makeTempDir();
    const env = createEnv(xdg);

    const missingTopic = runCli(['edt', 'delete'], env);
    expect(JSON.parse(missingTopic.stdout.trim()).error.code).toBe('invalid-argument');

    const malformed = runCli(['edt', 'delete', 'demo', '--branches', 'no-equals-sign'], env);
    expect(JSON.parse(malformed.stdout.trim()).error.code).toBe('invalid-argument');

    const badDisposition = runCli(['edt', 'delete', 'demo', '--branches', '/repo/a=maybe'], env);
    expect(JSON.parse(badDisposition.stdout.trim()).error.code).toBe('invalid-argument');
  });
});
