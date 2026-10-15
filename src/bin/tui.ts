import { join } from "node:path";
import { createElement } from "react";
import { render } from "ink";
import { AppShell } from "../adapters/driving/tui/app-shell.js";
import { createAppStore } from "../adapters/driving/tui/store/app-store.js";
import {
  acquireTuiLock,
  readLockFile,
} from "../adapters/driving/tui/single-instance.js";
import { createManifestCarryPort } from "../adapters/driven/manifest/carry.js";
import { loadManifest } from "../adapters/driven/manifest/index.js";
import { createContainerPort } from "../adapters/driven/container/index.js";
import { createMigrationPort } from "../adapters/driven/migration/index.js";
import { createEditorPort } from "../adapters/driven/editor/index.js";
import { createRestartPort } from "../adapters/driven/restart/index.js";
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
import { createSavedRequestPort, resolveGlobalDbFile } from "../adapters/driven/saved-requests/index.js";
import { createDockerPort } from "../adapters/driven/docker/index.js";
import { resolveXdgPaths } from "../adapters/driven/xdg/index.js";
import { moduleRegistry, resolveModule } from "../adapters/driven/modules/module-registry.js";
import { ROUTES_MODULE_ID, SHARED_TYPES_MODULE_IDS } from "../core/edt/resolve-tab-visibility.js";
import { err, ok } from "../core/result.js";
import type { DependencyConsumerConfig, SourceConfig } from "../core/shared-types/list-consumers.js";

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
      // Developer declines → exit 1, nothing killed/deleted
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

// Composition root wiring — the same port construction as src/bin/main.ts (same XDG-resolved
// files, same createGitPort(manifest, edtRegistry) cross-EDT wiring, same lock dir and
// edtsBaseDir), so the store's actions run the identical core use-cases in-process that the
// CLI runs out-of-process (AD-2).
const registryFile = resolveRegistryFile(xdg);
const registry = createRegistryPort(registryFile);
const manifest = { load: loadManifest };
const manifestCarry = createManifestCarryPort();
const edtsBaseDir = join(xdg.dataDir, "edts");
const edtRegistryFile = resolveEdtRegistryFile(xdg);
const edtRegistry = createEdtRegistryPort(edtRegistryFile, edtsBaseDir);
const git = createGitPort({ load: loadManifest }, edtRegistry);
const container = createContainerPort();
const migration = createMigrationPort();
const restart = createRestartPort();
const editor = createEditorPort();
const stateFile = resolveStateFile(xdg);
const state = createStatePort(stateFile);
// The registry screen's registerRepo needs a LockPort + resource key for withActionLock — the
// same lock dir and registry file as the CLI, so a TUI-initiated register and a hand-run CLI
// one serialize on the same resource. Named `actionLock` to tell it apart from the
// single-instance TUI `lock` above.
const actionLock = createLockPort(lockDir);
// The settings screen's persistence port — XDG_CONFIG_HOME/tui-back/settings.yaml,
// zod-validated like the manifest/registry.
const settingsFile = resolveSettingsFile(xdg);
const settings = createSettingsPort(settingsFile);
// The Logs zone's Docker touchpoint — no XDG/lock wiring needed (log ring buffers live only in
// memory, per process).
const docker = createDockerPort();
// The Routes zone's scanner, resolved out of the statically compiled module registry by
// manifest module id (AD-5), the same as the CLI so both scan through one implementation.
const routeExplorer = resolveModule(moduleRegistry, ROUTES_MODULE_ID);
if (routeExplorer?.kind !== 'route-explorer') {
  throw new Error(`${ROUTES_MODULE_ID} module is not registered`);
}
// The Routes zone's fire path needs the module's auth port alongside its scanner — the same
// wiring as the CLI's fire-request.
if (!routeExplorer.auth) {
  throw new Error(`${ROUTES_MODULE_ID} auth module is not registered`);
}
// The global saved-request library — the same <dataDir>/global.db store the CLI's
// request-* subcommands run against, so a TUI save is visible to the CLI and back.
const globalDbFile = resolveGlobalDbFile(xdg);
const savedRequests = createSavedRequestPort(globalDbFile);
// The shared-types zone: the consuming module's SharedTypesPort and manifest-parameter schema,
// resolved out of the registry by module id (AD-5) — core only ever sees the port and a parser.
const [SHARED_TYPES_SOURCE_ID, SHARED_TYPES_CONSUMER_ID] = SHARED_TYPES_MODULE_IDS;
const sharedTypesConsumer = resolveModule(moduleRegistry, SHARED_TYPES_CONSUMER_ID);
const sharedTypesSource = resolveModule(moduleRegistry, SHARED_TYPES_SOURCE_ID);
// A missing or wrong-kind module leaves the zone degraded (explicit error) instead of aborting.
// Source wiring is independent of consumer presence so a working source without a
// consumer still leaves publish available.
const sharedTypesPort = (
  sharedTypesConsumer?.kind === "shared-types" ? sharedTypesConsumer.shared : undefined
) ?? (sharedTypesSource?.kind === "shared-types" ? sharedTypesSource.shared : undefined);
const sharedTypes =
  sharedTypesPort === undefined
    ? undefined
    : {
        port: sharedTypesPort,
        ...(sharedTypesConsumer?.kind === "shared-types"
          ? {
              consumerModuleId: SHARED_TYPES_CONSUMER_ID,
              parseConsumerConfig: (raw: Record<string, unknown>) => {
                const parsed = sharedTypesConsumer.configSchema.safeParse(raw);
                return parsed.success
                  ? ok(parsed.data as DependencyConsumerConfig)
                  : err("invalid-module-config", `${SHARED_TYPES_CONSUMER_ID}: ${parsed.error.message}`);
              },
            }
          : {}),
        ...(sharedTypesSource?.kind === "shared-types"
          ? {
              sourceModuleId: SHARED_TYPES_SOURCE_ID,
              parseSourceConfig: (raw: Record<string, unknown>) => {
                const parsed = sharedTypesSource.configSchema.safeParse(raw);
                return parsed.success
                  ? ok(parsed.data as SourceConfig)
                  : err("invalid-module-config", `${SHARED_TYPES_SOURCE_ID}: ${parsed.error.message}`);
              },
            }
          : {}),
      };
const store = createAppStore({
  registry,
  manifest,
  manifestCarry,
  git,
  container,
  migration,
  restart,
  editor,
  edtRegistry,
  state,
  lock: actionLock,
  registryResourceKey: registryFile,
  edtRegistryResourceKey: edtRegistryFile,
  edtsBaseDir,
  settings,
  docker,
  scanner: routeExplorer.scanner,
  auth: routeExplorer.auth,
  savedRequests,
  sharedTypes,
});
const onQuit = async () => {
  if (tuiLock) {
    await tuiLock.release();
  }
  process.exit(0);
};

// Normal zone unmount stops every active `docker logs -f` subscription, but an abnormal exit
// (an uncaught crash, Ctrl+C, a `kill`) bypasses React's unmount path and would orphan the
// docker child processes. Stopping every LogsManager subscription here, on every exit path,
// closes that gap.
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
    // Ink's exitOnCtrlC is off: it swallows every Ctrl+C before any zone's useInput sees it
    // (ink/hooks/use-input.js), which would break the Logs zone's Ctrl+C "clear every open
    // pane" shortcut. `q` (app-shell.tsx's shouldQuit) is the quit key.
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
