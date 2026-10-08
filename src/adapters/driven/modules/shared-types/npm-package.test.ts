// adapters/driven/modules/shared-types: unit tests of the SharedTypesPort adapter against a
// fake filesystem and a fake registry runner (AD-13) — no real disk, no network.
import { describe, expect, it } from 'vitest';
import { createSharedTypesAdapter, type RegistryRunner, type SharedTypesFs } from './npm-package.js';

function fakeFs(files: Record<string, string>): SharedTypesFs & { files: Record<string, string> } {
  return {
    files,
    async readFile(path) {
      if (!(path in files)) {
        throw new Error(`ENOENT: ${path}`);
      }
      return files[path] as string;
    },
    async writeFile(path, content) {
      files[path] = content;
    },
  };
}

const DEP = '@ianord/shared-types';
const runnerOf = (result: Awaited<ReturnType<RegistryRunner>>): RegistryRunner => async () => result;

describe('readVersion', () => {
  it('returns the version from dependencies verbatim', async () => {
    const fs = fakeFs({ p: JSON.stringify({ dependencies: { [DEP]: '0.1.3674' } }) });
    expect(await createSharedTypesAdapter({ fs }).readVersion('p', DEP)).toEqual({ ok: true, data: '0.1.3674' });
  });

  it('returns a range from devDependencies verbatim', async () => {
    const fs = fakeFs({ p: JSON.stringify({ devDependencies: { [DEP]: '^0.1.3' } }) });
    expect(await createSharedTypesAdapter({ fs }).readVersion('p', DEP)).toEqual({ ok: true, data: '^0.1.3' });
  });

  it('fails with dependency-not-found when absent', async () => {
    const fs = fakeFs({ p: '{"dependencies":{"x":"1"}}' });
    expect(await createSharedTypesAdapter({ fs }).readVersion('p', DEP)).toMatchObject({
      ok: false,
      error: { code: 'dependency-not-found' },
    });
  });

  it('fails with package-json-unreadable on a missing file or invalid JSON', async () => {
    const fs = fakeFs({ bad: '{nope' });
    const adapter = createSharedTypesAdapter({ fs });
    expect(await adapter.readVersion('missing', DEP)).toMatchObject({ error: { code: 'package-json-unreadable' } });
    expect(await adapter.readVersion('bad', DEP)).toMatchObject({ error: { code: 'package-json-unreadable' } });
  });
});

describe('writeVersionLine', () => {
  it('changes only the version, preserving indent, CRLF and trailing newline', async () => {
    const original =
      '{\r\n\t"name": "app",\r\n\t"peerDependencies": { "@ianord/shared-types": "9.9.9" },\r\n' +
      '\t"dependencies": {\r\n\t\t"a": "1.0.0",\r\n\t\t"@ianord/shared-types": "0.1.3674",\r\n\t\t"z": "2.0.0"\r\n\t}\r\n}\r\n';
    const fs = fakeFs({ p: original });
    const result = await createSharedTypesAdapter({ fs }).writeVersionLine('p', DEP, '0.1.3700');
    expect(result).toEqual({ ok: true, data: undefined });
    expect(fs.files['p']).toBe(original.replace('"0.1.3674"', '"0.1.3700"'));
  });

  it('edits devDependencies when that is where the dependency lives', async () => {
    const original = '{\n  "devDependencies": {\n    "@ianord/shared-types": "^0.1.3"\n  }\n}';
    const fs = fakeFs({ p: original });
    await createSharedTypesAdapter({ fs }).writeVersionLine('p', DEP, '^0.1.4');
    expect(fs.files['p']).toBe(original.replace('^0.1.3', '^0.1.4'));
  });

  it('fails with dependency-not-found and leaves the file untouched', async () => {
    const fs = fakeFs({ p: '{"dependencies":{}}' });
    expect(await createSharedTypesAdapter({ fs }).writeVersionLine('p', DEP, '1')).toMatchObject({
      error: { code: 'dependency-not-found' },
    });
    expect(fs.files['p']).toBe('{"dependencies":{}}');
  });

  it('fails with package-json-unreadable on parse or write failure', async () => {
    const fs = fakeFs({ bad: '{nope', p: `{"dependencies":{"${DEP}":"1"}}` });
    fs.writeFile = async () => {
      throw new Error('EACCES');
    };
    const adapter = createSharedTypesAdapter({ fs });
    expect(await adapter.writeVersionLine('bad', DEP, '2')).toMatchObject({ error: { code: 'package-json-unreadable' } });
    expect(await adapter.writeVersionLine('p', DEP, '2')).toMatchObject({ error: { code: 'package-json-unreadable' } });
  });
});

describe('verifyPublished', () => {
  it('returns true when npm view prints the version', async () => {
    const adapter = createSharedTypesAdapter({ runner: runnerOf({ status: 0, stdout: '"0.1.3"\n', stderr: '' }) });
    expect(await adapter.verifyPublished(DEP, '0.1.3')).toEqual({ ok: true, data: true });
  });

  it('passes the package@version to npm view', async () => {
    let seen: readonly string[] = [];
    const runner: RegistryRunner = async (_c, args) => {
      seen = args;
      return { status: 0, stdout: '"1.0.0"', stderr: '' };
    };
    await createSharedTypesAdapter({ runner }).verifyPublished(DEP, '1.0.0');
    expect(seen).toEqual(['view', `${DEP}@1.0.0`, 'version', '--json']);
  });

  it('requires an exact match when npm prints several versions', async () => {
    const out = '["0.1.3","0.1.4"]';
    const adapter = createSharedTypesAdapter({ runner: runnerOf({ status: 0, stdout: out, stderr: '' }) });
    expect(await adapter.verifyPublished(DEP, '0.1.4')).toEqual({ ok: true, data: true });
    expect(await adapter.verifyPublished(DEP, '^0.1.0')).toEqual({ ok: true, data: false });
  });

  it('returns false (never an error) for empty output or an E404', async () => {
    const empty = createSharedTypesAdapter({ runner: runnerOf({ status: 0, stdout: '', stderr: '' }) });
    expect(await empty.verifyPublished(DEP, '9.9.9')).toEqual({ ok: true, data: false });
    const notFound = createSharedTypesAdapter({
      runner: runnerOf({ status: 1, stdout: '', stderr: `npm error code E404\nnpm error 404 No match` }),
    });
    expect(await notFound.verifyPublished(DEP, '9.9.9')).toEqual({ ok: true, data: false });
  });

  it('reports registry-unreachable on runner failure, timeout or other npm errors', async () => {
    const timedOut = createSharedTypesAdapter({
      runner: runnerOf({ status: null, stdout: '', stderr: '', error: new Error('timed out') }),
    });
    expect(await timedOut.verifyPublished(DEP, '1')).toMatchObject({ error: { code: 'registry-unreachable' } });
    const network = createSharedTypesAdapter({
      runner: runnerOf({ status: 1, stdout: '', stderr: 'npm error code ENOTFOUND' }),
    });
    expect(await network.verifyPublished(DEP, '1')).toMatchObject({ error: { code: 'registry-unreachable' } });
  });
});
