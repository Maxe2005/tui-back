import { createElement } from 'react';
import { render } from 'ink';
import { AppShell } from '../adapters/driving/tui/app-shell.js';
import { createAppStore } from '../adapters/driving/tui/store/app-store.js';
import { acquireTuiLock } from '../adapters/driving/tui/single-instance.js';
import { loadManifest } from '../adapters/driven/manifest/index.js';
import { createGitPort } from '../adapters/driven/git/index.js';
import { createRegistryPort, resolveRegistryFile } from '../adapters/driven/registry/index.js';
import { createEdtRegistryPort, resolveEdtRegistryFile } from '../adapters/driven/edt-registry/index.js';
import { createStatePort, resolveStateFile } from '../adapters/driven/state/index.js';
import { resolveXdgPaths } from '../adapters/driven/xdg/index.js';

// Interactive TUI entry point (AD-2/AD-3): composition root for the terminal UI.
// Deliberately separate from the CLI dispatch path (src/bin/main.ts): the TUI is
// an interactive surface, not a script action, so it must not route through
// runCli/renderResult and must not emit the AD-3 "exactly one final JSON line on
// non-TTY" envelope. No process.exit() here — render() keeps the process alive
// while the app is mounted and exits on Ctrl+C (exitOnCtrlC).
//
// Story 2.6: mirrors src/bin/main.ts's port wiring exactly (registry/manifest/edtRegistry/
// git/state) so the store's loadEdtsBranches action runs the exact same core use-case,
// in-process, that `tui-back edts` runs out-of-process (AD-2's script/CLI-parity principle
// extended to the TUI's own in-process call site — same core code either way).
if (!process.stdin.isTTY) {
  process.stderr.write('tui-back-tui requires an interactive terminal\n');
  process.exit(1);
}

let lock: { release: () => Promise<void> } | null = null;
try {
  lock = await acquireTuiLock();
  if (!lock) {
    process.stderr.write('Another TUI instance is already running\n');
    process.exit(1);
  }
} catch (error) {
  process.stderr.write('Failed to acquire TUI lock\n');
  process.exit(1);
}

// Composition root wiring — mirrors src/bin/main.ts's port construction exactly (same
// XDG-resolved files, same createGitPort(manifest, edtRegistry) cross-EDT wiring from
// story 2.4).
const xdg = resolveXdgPaths();
const registryFile = resolveRegistryFile(xdg);
const registry = createRegistryPort(registryFile);
const manifest = { load: loadManifest };
const edtRegistryFile = resolveEdtRegistryFile(xdg);
const edtRegistry = createEdtRegistryPort(edtRegistryFile);
const git = createGitPort({ load: loadManifest }, edtRegistry);
const stateFile = resolveStateFile(xdg);
const state = createStatePort(stateFile);

const store = createAppStore({ registry, manifest, git, edtRegistry, state });
const onQuit = async () => {
  if (lock) {
    await lock.release();
  }
  process.exit(0);
};

try {
  render(createElement(AppShell, { useStore: store, onQuit }), { exitOnCtrlC: true });
} catch (error) {
  if (lock) {
    await lock.release();
  }
  console.error(error);
  process.exit(1);
}