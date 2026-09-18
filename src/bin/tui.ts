import { join } from "node:path";
import { createElement } from "react";
import { render } from "ink";
import { AppShell } from "../adapters/driving/tui/app-shell.js";
import { createAppStore } from "../adapters/driving/tui/store/app-store.js";
import {
  acquireTuiLock,
  readLockFile,
} from "../adapters/driving/tui/single-instance.js";
import { loadManifest } from "../adapters/driven/manifest/index.js";
import { createGitPort } from "../adapters/driven/git/index.js";
import { createLockPort } from "../adapters/driven/lock/index.js";
import {
  createRegistryPort,
  resolveRegistryFile,
} from "../adapters/driven/registry/index.js";
import {
  createEdtRegistryPort,
  resolveEdtRegistryFile,
} from "../adapters/driven/edt-registry/index.js";
import {
  createStatePort,
  resolveStateFile,
} from "../adapters/driven/state/index.js";
import {
  createSettingsPort,
  resolveSettingsFile,
} from "../adapters/driven/settings/index.js";
import { createDockerPort } from "../adapters/driven/docker/index.js";
import { resolveXdgPaths } from "../adapters/driven/xdg/index.js";

if (!process.stdin.isTTY) {
  process.stderr.write("tui-back-tui requires an interactive terminal\n");
  process.exit(1);
}

const xdg = resolveXdgPaths();
const lockDir = `${xdg.stateDir}/locks`;
const lockFile = `${lockDir}/tui.lock`;

let tuiLock: { release: () => Promise<void> } | null = null;
try {
  tuiLock = await acquireTuiLock();
  if (!tuiLock) {
    const existingLock = readLockFile(lockFile);
    if (existingLock) {
      process.stderr.write(
        `\nAnother TUI instance is already running (PID ${existingLock.pid}, started at ${existingLock.timestamp}).\n`,
      );
      process.stderr.write(
        "Would you like to kill the existing process and take over? (y/n)\n",
      );
      const answer = await new Promise<string>((resolve) => {
        process.stdin!.addListener("data", (data: NodeJS.ReadableStream) => {
          const input = data.toString().trim().toLowerCase();
          resolve(input);
        });
      });
      if (answer === "y" || answer === "yes") {
        try {
          process.kill(existingLock.pid, "SIGTERM");
        } catch {
          // Process already terminated
        }
        process.exit(0);
      }
      // AC4: developer declines → exit 1, nothing killed/deleted
      process.stderr.write("Another TUI instance is already running\n");
      process.exit(1);
    }
    process.stderr.write("Another TUI instance is already running\n");
    process.exit(1);
  }
} catch (error) {
  process.stderr.write("Failed to acquire TUI lock\n");
  process.exit(1);
}

// Composition root wiring — mirrors src/bin/main.ts's port construction exactly (same
// XDG-resolved files, same createGitPort(manifest, edtRegistry) cross-EDT wiring from
// story 2.4). Story 2.9 adds lock/edtsBaseDir, mirroring main.ts's own
// createLockPort(lockDir)/join(xdg.dataDir, 'edts') exactly, so the store's
// createEdt/switchEdt/modifyEdt actions run the identical core use-cases, in-process, that
// `tui-back edt create|switch|modify` run out-of-process (AD-2).
const registryFile = resolveRegistryFile(xdg);
const registry = createRegistryPort(registryFile);
const manifest = { load: loadManifest };
const edtsBaseDir = join(xdg.dataDir, "edts");
const edtRegistryFile = resolveEdtRegistryFile(xdg);
const edtRegistry = createEdtRegistryPort(edtRegistryFile, edtsBaseDir);
const git = createGitPort({ load: loadManifest }, edtRegistry);
const stateFile = resolveStateFile(xdg);
const state = createStatePort(stateFile);
// Story 2.11: the repo registry screen reuses Story 1.5's registerRepo use-case as-is
// (AD-2), which requires a LockPort + a resource key for its withActionLock call — mirrors
// src/bin/main.ts:39-44's CLI composition root exactly (same lock dir, same registry file
// as the resource key so a TUI-initiated register and a hand-run CLI one serialize on the
// same resource rather than racing each other). Named `actionLock` (distinct from the
// single-instance TUI `lock` above) since both live in this module's scope.
const actionLock = createLockPort(lockDir);
// Story 2.19: the settings screen's persistence port — XDG_CONFIG_HOME/tui-back/settings.yaml,
// zod-validated like the manifest/registry, independent of every EDT/global SQLite store.
const settingsFile = resolveSettingsFile(xdg);
const settings = createSettingsPort(settingsFile);
// Story 5.1: the Logs zone's Docker touchpoint — no XDG/lock wiring needed (DockerPort has no
// persisted state of its own; the Logs zone's ring buffers live only in memory, per-process).
const docker = createDockerPort();
const store = createAppStore({
  registry,
  manifest,
  git,
  edtRegistry,
  state,
  lock: actionLock,
  registryResourceKey: registryFile,
  edtRegistryResourceKey: edtRegistryFile,
  edtsBaseDir,
  settings,
  docker,
});
const onQuit = async () => {
  if (tuiLock) {
    await tuiLock.release();
  }
  process.exit(0);
};

// Story 5.1 review fix: normal zone-unmount teardown already stops every active
// `docker logs -f` subscription (see logs-zone.tsx's own unmount effect), but an abnormal exit
// (an uncaught crash, Ctrl+C, a `kill`) bypasses React's unmount path entirely and would
// otherwise orphan any still-running docker child processes indefinitely. Stopping every active
// LogsManager subscription here, on every exit path, closes that gap regardless of how the
// process is going down.
let stoppedLogsPanes = false;
const stopAllLogsPanes = () => {
  if (stoppedLogsPanes) {
    return;
  }
  stoppedLogsPanes = true;
  try {
    store.getState().stopAllLogsPanes();
  } catch {
    // Best-effort on the way out — never block the process from actually exiting.
  }
};
process.on("exit", stopAllLogsPanes);
// `process.on('exit', ...)` alone only covers a process that was already going to exit on its
// own (a crash, an explicit process.exit() elsewhere). Registering a SIGINT/SIGTERM listener
// suppresses Node's own default terminate-on-signal behavior, so each handler here must also
// call process.exit() itself once cleanup is done, or the process would hang forever instead
// of actually terminating.
process.on("SIGINT", () => {
  stopAllLogsPanes();
  process.exit(130);
});
process.on("SIGTERM", () => {
  stopAllLogsPanes();
  process.exit(143);
});

try {
  render(createElement(AppShell, { useStore: store, onQuit }), {
    // User-reported (story 5.1 follow-up): Ink's own exitOnCtrlC swallows every Ctrl+C
    // keypress before any zone's useInput ever sees it (ink/hooks/use-input.js: "If app is
    // supposed to exit on Ctrl+C, skip input listeners") — incompatible with the Logs zone's
    // Ctrl+C "clear every open pane" shortcut. `q` (app-shell.tsx's shouldQuit) is the app's
    // real quit key; Ctrl+C is no longer a second one.
    exitOnCtrlC: false,
    alternateScreen: true,
  });
} catch (error) {
  if (tuiLock) {
    await tuiLock.release();
  }
  console.error(error);
  process.exit(1);
}
