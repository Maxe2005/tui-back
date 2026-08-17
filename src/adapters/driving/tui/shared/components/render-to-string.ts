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

export async function renderToString(node: ReactNode): Promise<string> {
  let output = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
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