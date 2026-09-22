// adapters/driven/modules/route-explorer/nestjs-openapi: integration tests against real
// temp dirs + real files (AD-13). node:fs is deliberately not mocked — this adapter's
// whole contract is how real OpenAPI documents on disk surface as Route[] vs the named
// `route-scan-failed` Result (never a throw, never a failure disguised as empty).
import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNestjsOpenApiScanner } from './nestjs-openapi.js';

const tmpDirs: string[] = [];

async function tempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tui-back-openapi-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

const SPEC = {
  openapi: '3.0.0',
  info: { title: 'Gateway', version: '1.0.0' },
  paths: {
    '/users': {
      get: { summary: 'List users' },
      post: { description: 'Create a user' },
    },
    '/health': {
      get: { operationId: 'healthCheck' },
    },
  },
};

describe('nestjs-openapi scanner', () => {
  it('reads openapi.json by convention and lists every METHOD + path row', async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'openapi.json'), JSON.stringify(SPEC));

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toEqual({
      ok: true,
      data: [
        { method: 'GET', path: '/users', summary: 'List users' },
        { method: 'POST', path: '/users', summary: 'Create a user' },
        { method: 'GET', path: '/health' },
      ],
    });
  });

  it('reads a YAML spec by convention', async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'openapi.yaml'), 'openapi: 3.0.0\ninfo: {title: t, version: "1"}\npaths:\n  /ping:\n    get:\n      summary: Ping\n');

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toEqual({ ok: true, data: [{ method: 'GET', path: '/ping', summary: 'Ping' }] });
  });

  it('honors an explicit manifest-configured spec file', async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'docs-spec.json'), JSON.stringify(SPEC));

    const result = await createNestjsOpenApiScanner().scan(repo, { openapi: 'docs-spec.json' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(3);
    }
  });

  it('fetches a manifest-configured http(s) spec URL', async () => {
    const repo = await tempRepo();
    const scanner = createNestjsOpenApiScanner({
      fetchSpec: async () => JSON.stringify(SPEC),
    });

    const result = await scanner.scan(repo, { openapi: 'https://example.invalid/openapi.json' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(3);
    }
  });

  it('returns route-scan-failed (never a throw, never empty) for an unparsable spec', async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'openapi.json'), '{ not valid json, [unclosed');

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it('returns route-scan-failed for a spec that is valid JSON but not an OpenAPI object', async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'openapi.json'), JSON.stringify(['not', 'an', 'object']));

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it('returns route-scan-failed when no spec file exists anywhere', async () => {
    const repo = await tempRepo();

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
    if (!result.ok) {
      expect(result.error.details).toHaveProperty('reason');
    }
  });

  it('returns route-scan-failed for a configured spec file that cannot be read', async () => {
    const repo = await tempRepo();

    const result = await createNestjsOpenApiScanner().scan(repo, { openapi: 'missing.json' });

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it('returns a genuinely-empty ok list for a valid spec with zero paths', async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'openapi.json'), JSON.stringify({ openapi: '3.0.0', info: {}, paths: {} }));

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toEqual({ ok: true, data: [] });
  });

  it('returns route-scan-failed for a non-object path item instead of skipping it', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'openapi.json'),
      JSON.stringify({ openapi: '3.0.0', info: {}, paths: { '/users': ['not', 'an', 'object'] } }),
    );

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it('returns route-scan-failed for a non-object operation instead of skipping it', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'openapi.json'),
      JSON.stringify({ openapi: '3.0.0', info: {}, paths: { '/users': { get: 'not-an-object' } } }),
    );

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it('returns route-scan-failed for a non-lowercase method key instead of omitting the route', async () => {
    const repo = await tempRepo();
    await writeFile(
      join(repo, 'openapi.json'),
      JSON.stringify({ openapi: '3.0.0', info: {}, paths: { '/users': { GET: { summary: 'List' } } } }),
    );

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it.each(['openapi', 'openapiPath', 'specPath'])('honors the %s manifest key as a spec file', async (key) => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'docs-spec.json'), JSON.stringify(SPEC));

    const result = await createNestjsOpenApiScanner().scan(repo, { [key]: 'docs-spec.json' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(3);
    }
  });

  it.each(['openapiUrl', 'specUrl'])('honors the %s manifest key as a spec URL', async (key) => {
    const repo = await tempRepo();
    const scanner = createNestjsOpenApiScanner({
      fetchSpec: async () => JSON.stringify(SPEC),
    });

    const result = await scanner.scan(repo, { [key]: 'https://example.invalid/openapi.json' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(3);
    }
  });

  it('treats an http(s) openapi value as a URL even when the key is the generic openapi one', async () => {
    const repo = await tempRepo();
    let fetchedUrl: string | undefined;
    const scanner = createNestjsOpenApiScanner({
      fetchSpec: async (url: string) => {
        fetchedUrl = url;
        return JSON.stringify(SPEC);
      },
    });

    const result = await scanner.scan(repo, { openapi: 'https://example.invalid/openapi.json' });

    expect(fetchedUrl).toBe('https://example.invalid/openapi.json');
    expect(result.ok).toBe(true);
  });

  it('fails instead of falling through when the first candidate is broken but a later one is valid', async () => {
    const repo = await tempRepo();
    await writeFile(join(repo, 'openapi.json'), '{ not valid json, [unclosed');
    await writeFile(join(repo, 'openapi.yaml'), 'openapi: 3.0.0\ninfo: {title: t, version: "1"}\npaths:\n  /ping:\n    get:\n      summary: Ping\n');

    const result = await createNestjsOpenApiScanner().scan(repo, {});

    expect(result).toMatchObject({ ok: false, error: { code: 'route-scan-failed' } });
  });

  it('passes an abort signal when fetching the default URL implementation', async () => {
    let seenSignal: unknown;
    const stubFetch = async (_url: string, init?: { signal?: unknown }) => {
      seenSignal = init?.signal;
      return { ok: true, text: async () => JSON.stringify(SPEC) };
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubFetch as unknown as typeof fetch;
    try {
      const repo = await tempRepo();

      const result = await createNestjsOpenApiScanner().scan(repo, { openapi: 'https://example.invalid/openapi.json' });

      expect(seenSignal).toBeInstanceOf(AbortSignal);
      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
