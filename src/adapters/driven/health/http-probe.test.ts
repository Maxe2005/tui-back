import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpHealthProbe } from './http-probe.js';

let server: Server | undefined;

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  server = undefined;
});

describe('createHttpHealthProbe', () => {
  it('is healthy on a 2xx answer', async () => {
    const url = await serve((_req, res) => res.writeHead(204).end());
    expect(await createHttpHealthProbe().probe(url, 1000)).toEqual({ ok: true, data: { healthy: true, status: 204 } });
  });

  it('is unhealthy on a non-2xx answer', async () => {
    const url = await serve((_req, res) => res.writeHead(503).end());
    expect(await createHttpHealthProbe().probe(url, 1000)).toEqual({
      ok: true,
      data: { healthy: false, status: 503, reason: 'HTTP 503' },
    });
  });

  it('is unhealthy on timeout', async () => {
    const url = await serve(() => {});
    const result = await createHttpHealthProbe().probe(url, 50);
    expect(result.ok && result.data.healthy).toBe(false);
    expect(result.ok && result.data.reason).toMatch(/timed out/);
  });

  it('is unhealthy when the connection is refused, never throws', async () => {
    const result = await createHttpHealthProbe().probe('http://127.0.0.1:1/', 500);
    expect(result.ok && result.data.healthy).toBe(false);
  });

  it('does not follow redirects: a 3xx is unhealthy', async () => {
    const url = await serve((_req, res) => res.writeHead(302, { location: 'http://127.0.0.1:1/login' }).end());
    const result = await createHttpHealthProbe().probe(url, 1000);
    expect(result).toEqual({ ok: true, data: { healthy: false, status: 302, reason: 'HTTP 302' } });
  });

  it('rejects a non-http(s) url', async () => {
    const result = await createHttpHealthProbe().probe('ftp://host/x', 500);
    expect(!result.ok && result.error.code).toBe('invalid-argument');
  });

  it('rejects a blank url', async () => {
    const result = await createHttpHealthProbe().probe('  ', 500);
    expect(result.ok).toBe(false);
  });
});
