import { render } from 'ink';
import { Writable } from 'node:stream';
import type { ReactNode } from 'react';

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
    interactive: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  try {
    instance.unmount();
    await instance.waitUntilExit();
    return output;
  } catch (error) {
    instance.unmount();
    throw error;
  }
}
