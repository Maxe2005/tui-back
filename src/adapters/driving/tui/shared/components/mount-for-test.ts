// tui/shared/components: keeps a tree mounted (renderToString unmounts at once) so a test can read
// effects' results — e.g. the footer context a screen registered — before unmounting it.
import { render } from 'ink';
import { Readable, Writable } from 'node:stream';
import type { ReactNode } from 'react';

export async function mountForTest(node: ReactNode): Promise<{ frame: () => string; unmount: () => void }> {
  let output = '';
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  Object.assign(stdout, { columns: 120, rows: 40 });
  const stdin = new Readable({ read: () => null });
  Object.defineProperty(stdin, 'isTTY', { value: true });
  Object.assign(stdin, { setRawMode: () => {}, ref: () => {}, unref: () => {} });
  const instance = render(node, {
    stdout: stdout as unknown as NodeJS.WriteStream,
    stdin: stdin as unknown as NodeJS.ReadStream,
    interactive: false,
    exitOnCtrlC: false,
    patchConsole: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { frame: () => output, unmount: () => instance.unmount() };
}

// The footer context the tree registers once mounted, read from the given store.
export async function footerContextOf(
  store: { getState: () => { footerContexts: readonly { id: string }[] } },
  node: ReactNode,
): Promise<string | undefined> {
  const mounted = await mountForTest(node);
  const id = store.getState().footerContexts.at(-1)?.id;
  mounted.unmount();
  return id;
}
