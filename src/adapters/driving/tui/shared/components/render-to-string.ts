import { render } from 'ink';
import { Readable, Writable } from 'node:stream';
import type { ReactNode } from 'react';

function createFakeTtyStdin(): NodeJS.ReadStream {
  const stdin = new Readable({
    read() {
      return null;
    },
  });
  Object.defineProperty(stdin, 'isTTY', { value: true });
  (stdin as unknown as Record<string, () => void>).setRawMode = () => {};
  (stdin as unknown as Record<string, () => void>).ref = () => {};
  (stdin as unknown as Record<string, () => void>).unref = () => {};
  return stdin as unknown as NodeJS.ReadStream;
}

export async function renderToString(node: ReactNode, size: { columns: number; rows: number } = { columns: 120, rows: 40 }): Promise<string> {
  let output = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  // Ink's getWindowSize() falls through to a real terminal-size probe of the test process
  // (ink/build/utils.js) whenever this Writable doesn't report both columns and rows, making
  // wrap-sensitive assertions non-deterministic across environments. `size` (120x40 by default)
  // pins the layout, and lets the bounded-rendering matrix render at other terminal sizes.
  Object.assign(stdout, size);
  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: createFakeTtyStdin(),
    interactive: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  try {
    const exit = instance.waitUntilExit();
    instance.unmount();
    await exit;
    return output;
  } catch (error) {
    instance.unmount();
    throw error;
  }
}