import { createElement } from 'react';
import { render } from 'ink';
import { AppShell } from '../adapters/driving/tui/app-shell.js';
import { createAppStore } from '../adapters/driving/tui/store/app-store.js';

// Interactive TUI entry point (AD-2/AD-3): composition root for the terminal UI.
// Deliberately separate from the CLI dispatch path (src/bin/main.ts): the TUI is
// an interactive surface, not a script action, so it must not route through
// runCli/renderResult and must not emit the AD-3 "exactly one final JSON line on
// non-TTY" envelope. No process.exit() here — render() keeps the process alive
// while the app is mounted and exits on Ctrl+C (exitOnCtrlC).
if (!process.stdin.isTTY) {
  process.stderr.write('tui-back-tui requires an interactive terminal\n');
  process.exit(1);
}

const store = createAppStore();
try {
  render(createElement(AppShell, { useStore: store }), { exitOnCtrlC: true });
} catch (error) {
  console.error(error);
  process.exit(1);
}
