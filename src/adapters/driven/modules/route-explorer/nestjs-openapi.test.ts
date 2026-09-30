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

  describe('request details (story 6.6)', () => {
    async function scanSpec(spec: unknown) {
      const repo = await tempRepo();
      await writeFile(join(repo, 'openapi.json'), JSON.stringify(spec));
      const result = await createNestjsOpenApiScanner().scan(repo, {});
      if (!result.ok) {
        throw new Error(`scan failed: ${result.error.message}`);
      }
      return result.data;
    }

    const base = { openapi: '3.0.0', info: {} };

    it('merges path-item and operation parameters, the operation winning on name+in', async () => {
      const routes = await scanSpec({
        ...base,
        components: { parameters: { Limit: { name: 'limit', in: 'query', schema: { type: 'integer', example: 20 } } } },
        paths: {
          '/orders/{id}': {
            parameters: [
              { name: 'id', in: 'path', example: 42 },
              { name: 'limit', in: 'query', required: false, example: 5 },
              { name: 'session', in: 'cookie' },
            ],
            get: {
              parameters: [{ $ref: '#/components/parameters/Limit' }, { name: 'X-Trace', in: 'header', required: true }],
            },
          },
        },
      });

      expect(routes).toEqual([
        {
          method: 'GET',
          path: '/orders/{id}',
          parameters: [
            { name: 'id', in: 'path', required: true, example: 42 },
            { name: 'limit', in: 'query', required: false, example: 20 },
            { name: 'X-Trace', in: 'header', required: true },
          ],
        },
      ]);
    });

    it('uses an explicit media example as bodyExample', async () => {
      const routes = await scanSpec({
        ...base,
        paths: {
          '/orders': {
            post: { requestBody: { content: { 'application/json': { example: { qty: 2 }, schema: { type: 'object' } } } } },
          },
        },
      });

      expect(routes[0]).toEqual({
        method: 'POST',
        path: '/orders',
        bodyContentType: 'application/json',
        bodyExample: { qty: 2 },
      });
    });

    it('generates a skeleton from a $ref schema (requestBody itself may be a $ref)', async () => {
      const routes = await scanSpec({
        ...base,
        components: {
          requestBodies: {
            NewOrder: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewOrder' } } } },
          },
          schemas: {
            NewOrder: {
              type: 'object',
              properties: {
                customer: { type: 'object', properties: { name: { type: 'string' } } },
                items: { type: 'array', items: { type: 'integer' } },
                kind: { type: 'string', enum: ['a', 'b'] },
              },
            },
          },
        },
        paths: { '/orders': { post: { requestBody: { $ref: '#/components/requestBodies/NewOrder' } } } },
      });

      expect(routes[0]).toMatchObject({
        bodyContentType: 'application/json',
        bodyExample: { customer: { name: '' }, items: [0], kind: 'a' },
      });
    });

    it('terminates on a recursive schema and still lists the route', async () => {
      const routes = await scanSpec({
        ...base,
        components: {
          schemas: { Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } } },
        },
        paths: {
          '/tree': {
            post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } },
          },
        },
      });

      expect(routes[0]).toMatchObject({ path: '/tree', bodyExample: { next: null } });
    });

    it('sets only bodyContentType for a non-JSON body (nothing fabricated)', async () => {
      const routes = await scanSpec({
        ...base,
        paths: {
          '/upload': {
            post: { requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } } },
          },
        },
      });

      expect(routes).toEqual([{ method: 'POST', path: '/upload', bodyContentType: 'multipart/form-data' }]);
    });

    it('prefers application/json, then a +json type, over other declared types', async () => {
      const routes = await scanSpec({
        ...base,
        paths: {
          '/a': { post: { requestBody: { content: { 'text/plain': {}, 'application/vnd.x+json': { example: 1 } } } } },
          '/b': {
            post: {
              requestBody: { content: { 'application/vnd.x+json': { example: 1 }, 'application/json': { example: 2 } } },
            },
          },
        },
      });

      expect(routes.map((route) => [route.bodyContentType, route.bodyExample])).toEqual([
        ['application/vnd.x+json', 1],
        ['application/json', 2],
      ]);
    });

    it('keeps the exact pre-6.6 shape for operations without request details', async () => {
      const routes = await scanSpec({ ...base, paths: { '/health': { get: { summary: 'Health' } } } });

      expect(routes).toEqual([{ method: 'GET', path: '/health', summary: 'Health' }]);
    });

    it('degrades malformed parameters / requestBody / $refs to a plain route without failing the scan', async () => {
      const routes = await scanSpec({
        ...base,
        paths: {
          '/broken': {
            parameters: 'nope',
            post: {
              summary: 'Broken',
              parameters: [{ $ref: '#/components/parameters/Missing' }, 42, { name: 'x', in: 'body' }],
              requestBody: { $ref: 'https://example.invalid/rb.json' },
            },
          },
        },
      });

      expect(routes).toEqual([{ method: 'POST', path: '/broken', summary: 'Broken' }]);
    });
  });
});
