// tui/shared/test-support: keeps a tree mounted (renderToString unmounts at once) so a test can read
// effects' results — e.g. the footer context a screen registered — before unmounting it.
import { render } from 'ink';
import { Readable, Writable } from 'node:stream';
import type { ReactNode } from 'react';
import { activeFooterContext, type FooterContextEntry } from '../../keybindings/index.js';

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
  store: { getState: () => { footerContexts: readonly FooterContextEntry[] } },
  node: ReactNode,
): Promise<string | undefined> {
  const mounted = await mountForTest(node);
  const id = activeFooterContext(store.getState().footerContexts);
  mounted.unmount();
  return id;
}

// The footer context currently shown for a store (overlays win over zones).
export function footerIdOf(store: { getState: () => { footerContexts: readonly FooterContextEntry[] } }): string | undefined {
  return activeFooterContext(store.getState().footerContexts);
}
