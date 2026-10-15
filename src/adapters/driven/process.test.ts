import { describe, expect, it } from 'vitest';
import { streamProcess } from './process.js';

const node = (script: string) => ['-e', script] as const;

describe('streamProcess', () => {
  it('splits lines that straddle chunks and delivers an unterminated last line', async () => {
    const lines: string[] = [];
    const result = await streamProcess('node', node("process.stdout.write('ab'); setTimeout(() => process.stdout.write('c\\nde\\r\\nlast'), 30)"), {
      onLine: (line) => { lines.push(line); },
    });
    expect(lines).toEqual(['abc', 'de', 'last']);
    expect(result).toMatchObject({ status: 0, aborted: false, stopped: false });
  });

  it('stops and kills the child when onLine returns false', async () => {
    const lines: string[] = [];
    const result = await streamProcess('node', node("console.log('a'); console.log('b'); setInterval(() => {}, 1000)"), {
      onLine: (line) => { lines.push(line); return false; },
    });
    expect(lines).toEqual(['a']);
    expect(result).toMatchObject({ stopped: true, aborted: false });
  });

  it('reports aborted, distinct from stopped, when the signal fires mid-stream', async () => {
    const controller = new AbortController();
    const result = await streamProcess('node', node("console.log('go'); setInterval(() => {}, 1000)"), {
      signal: controller.signal,
      onLine: () => { controller.abort(); },
    });
    expect(result).toMatchObject({ aborted: true, stopped: false });
  });

  it('reports aborted without spawning when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const lines: string[] = [];
    const result = await streamProcess('node', node("console.log('never')"), { signal: controller.signal, onLine: (line) => { lines.push(line); } });
    expect(result.aborted).toBe(true);
    expect(lines).toEqual([]);
  });

  it('reports a spawn failure through error, never a rejection', async () => {
    const result = await streamProcess('definitely-not-a-binary-xyz', [], { onLine: () => {} });
    expect(result.status).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
  });

  it('turns a throwing onLine into an error result and kills the child', async () => {
    const result = await streamProcess('node', node("console.log('x'); setInterval(() => {}, 1000)"), {
      onLine: () => {
        throw new Error('boom');
      },
    });
    expect(result.error?.message).toBe('boom');
    expect(result.status).toBeNull();
  });
});
