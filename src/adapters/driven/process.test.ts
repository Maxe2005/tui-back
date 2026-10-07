import { describe, expect, it } from 'vitest';
import { runProcess } from './process.js';

describe('runProcess', () => {
  it('captures stdout, stderr and the exit status', async () => {
    const result = await runProcess('sh', ['-c', 'echo out; echo err >&2; exit 3']);
    expect(result).toMatchObject({ status: 3, stdout: 'out\n', stderr: 'err\n' });
  });

  it('keeps the event loop running while the child is in flight', async () => {
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
    }, 10);
    await runProcess('sh', ['-c', 'sleep 0.2']);
    clearInterval(timer);
    expect(ticks).toBeGreaterThan(3);
  });

  it('reports a missing binary as a null status with an error, never a rejection', async () => {
    const result = await runProcess('definitely-not-a-binary-xyz', []);
    expect(result.status).toBeNull();
    expect((result.error as NodeJS.ErrnoException).code).toBe('ENOENT');
  });

  it('reports a bad cwd as a null status', async () => {
    const result = await runProcess('sh', ['-c', 'true'], { cwd: '/nonexistent-dir-xyz' });
    expect(result.status).toBeNull();
  });

  it('kills the child and reports ETIMEDOUT when the timeout elapses', async () => {
    const result = await runProcess('sh', ['-c', 'sleep 5'], { timeout: 50 });
    expect(result.status).toBeNull();
    expect((result.error as NodeJS.ErrnoException).code).toBe('ETIMEDOUT');
  });

  it('kills the child and reports ENOBUFS past maxBuffer', async () => {
    const result = await runProcess('sh', ['-c', 'yes | head -c 5000'], { maxBuffer: 100 });
    expect(result.status).toBeNull();
    expect((result.error as NodeJS.ErrnoException).code).toBe('ENOBUFS');
  });
});
