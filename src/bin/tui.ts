import { createElement } from 'react';
import { render } from 'ink';
import { AppShell } from '../adapters/driving/tui/app-shell.js';
import { createAppStore } from '../adapters/driving/tui/store/app-store.js';
import { acquireTuiLock, readLockFile } from '../adapters/driving/tui/single-instance.js';
import { loadManifest } from '../adapters/driven/manifest/index.js';
import { createGitPort } from '../adapters/driven/git/index.js';
import { createRegistryPort, resolveRegistryFile } from '../adapters/driven/registry/index.js';
import { createEdtRegistryPort, resolveEdtRegistryFile } from '../adapters/driven/edt-registry/index.js';
import { createStatePort, resolveStateFile } from '../adapters/driven/state/index.js';
import { resolveXdgPaths } from '../adapters/driven/xdg/index.js';

if (!process.stdin.isTTY) {
  process.stderr.write('tui-back-tui requires an interactive terminal\n');
  process.exit(1);
}

const xdg = resolveXdgPaths();
const lockDir = `${xdg.stateDir}/locks`;
const lockFile = `${lockDir}/tui.lock`;

let lock: { release: () => Promise<void> } | null = null;
try {
  lock = await acquireTuiLock();
  if (!lock) {
    const existingLock = readLockFile(lockFile);
    if (existingLock) {
      process.stderr.write(`\nAnother TUI instance is already running (PID ${existingLock.pid}, started at ${existingLock.timestamp}).\n`);
      process.stderr.write('Would you like to kill the existing process and take over? (y/n)\n');
      const answer = await new Promise<string>(resolve => {
        process.stdin!.addListener('data', (data: NodeJS.ReadableStream) => {
          const input = data.toString().trim().toLowerCase();
          resolve(input);
        });
      });
      if (answer === 'y' || answer === 'yes') {
        try {
          process.kill(existingLock.pid, 'SIGTERM');
        } catch {
          // Process already terminated
        }
        process.exit(0);
      }
      // AC4: developer declines → exit 1, nothing killed/deleted
      process.stderr.write('Another TUI instance is already running\n');
      process.exit(1);
    }
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
  render(createElement(AppShell, { useStore: store, onQuit }), {
    exitOnCtrlC: true,
    alternateScreen: true,
  });
} catch (error) {
  if (lock) {
    await lock.release();
  }
  console.error(error);
  process.exit(1);
}