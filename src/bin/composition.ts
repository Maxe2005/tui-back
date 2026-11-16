// Shared composition factory: wires the driven ports and builds the production subcommand
// registry. Used by the CLI entry (main.ts) and the MCP entry (mcp.ts); importing it has no side
// effects, unlike a composition root that runs on import.
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Subcommand } from '../adapters/driving/cli/dispatch.js';
import { buildSubcommands } from '../adapters/driving/cli/subcommands.js';
import { createManifestCarryPort } from '../adapters/driven/manifest/carry.js';
import { loadManifest } from '../adapters/driven/manifest/index.js';
import { createDockerPort } from '../adapters/driven/docker/index.js';
import { createContainerPort } from '../adapters/driven/container/index.js';
import { createMigrationPort } from '../adapters/driven/migration/index.js';
import { createEditorPort } from '../adapters/driven/editor/index.js';
import { createHttpHealthProbe } from '../adapters/driven/health/http-probe.js';
import { createRestartPort } from '../adapters/driven/restart/index.js';
import { createLockPort } from '../adapters/driven/lock/index.js';
import { createGitPort } from '../adapters/driven/git/index.js';
import { createRegistryPort, resolveRegistryFile } from '../adapters/driven/registry/index.js';
import { createEdtRegistryPort, resolveEdtRegistryFile } from '../adapters/driven/edt-registry/index.js';
import { createStatePort, resolveStateFile } from '../adapters/driven/state/index.js';
import { createSavedRequestPort, resolveGlobalDbFile } from '../adapters/driven/saved-requests/index.js';
import { createSettingsPort, resolveSettingsFile } from '../adapters/driven/settings/index.js';
import { createInstallerPort } from '../adapters/driven/installer/index.js';
import { resolveXdgPaths } from '../adapters/driven/xdg/index.js';
import { moduleRegistry, resolveModule } from '../adapters/driven/modules/module-registry.js';
import { ROUTES_MODULE_ID } from '../core/edt/resolve-tab-visibility.js';

export interface ComposeOptions {
  /** Whether a y/N prompt can be read back (stdin AND stdout are TTYs). The MCP path passes false: it never reads stdin. */
  interactive: boolean;
}

export function composeSubcommands({ interactive }: ComposeOptions): Subcommand[] {
  const xdg = resolveXdgPaths();
  const registryFile = resolveRegistryFile(xdg);
  const registry = createRegistryPort(registryFile);
  const manifest = { load: loadManifest };
  const manifestCarry = createManifestCarryPort();
  const edtsBaseDir = join(xdg.dataDir, 'edts');
  const edtRegistryFile = resolveEdtRegistryFile(xdg);
  const edtRegistry = createEdtRegistryPort(edtRegistryFile, edtsBaseDir);
  // The git adapter is wired with the EdtRegistryPort so assertAllowedBranch can apply AD-8's
  // cross-EDT half (a branch already registered as a *different* EDT's own branch for a repo)
  // when a call site passes an edtId.
  const git = createGitPort({ load: loadManifest }, edtRegistry);
  const container = createContainerPort();
  const migration = createMigrationPort();
  const restart = createRestartPort();
  const stateFile = resolveStateFile(xdg);
  const state = createStatePort(stateFile);
  // The global saved-request library lives at <dataDir>/global.db (same XDG resolution as the
  // other stores): one sqlite file, hand-rolled numbered SQL, no migration framework.
  const globalDbFile = resolveGlobalDbFile(xdg);
  const savedRequests = createSavedRequestPort(globalDbFile);

  // Per-resource advisory lock directory under XDG_STATE_HOME/tui-back/locks. The lock adapter
  // creates it lazily on first acquire, so read-only commands never write state and an
  // unwritable state dir surfaces as a Result error rather than a startup crash. The registry
  // file path is the resource key register/reset lock on, so concurrent CLI runs serialize
  // instead of racing the read-modify-write; `edt create` locks on the EDT registry file.
  const lockDir = join(xdg.stateDir, 'locks');
  const lock = createLockPort(lockDir);
  // The route-explorer module's scanner, resolved out of the statically compiled module registry
  // by manifest module id (AD-5) — manifests only select this key, never supply code. The lookup
  // cannot fail in practice (registry and key are compiled together); the throw is a loud
  // programmer-error signal, raised before any stdout output so the envelope is unaffected.
  const routeExplorer = resolveModule(moduleRegistry, ROUTES_MODULE_ID);
  if (routeExplorer?.kind !== 'route-explorer') {
    throw new Error(`${ROUTES_MODULE_ID} module is not registered`);
  }
  // The fire-request use-case needs the module's auth port alongside its scanner — same
  // static-registry reasoning as the scanner lookup above.
  if (routeExplorer.auth === undefined) {
    throw new Error(`${ROUTES_MODULE_ID} auth module is not registered`);
  }
  return buildSubcommands({
    registry,
    manifest,
    manifestCarry,
    lock,
    registryResourceKey: registryFile,
    edtsBaseDir,
    edtRegistry,
    edtRegistryResourceKey: edtRegistryFile,
    git,
    container,
    docker: createDockerPort(),
    migration,
    restart,
    state,
    settings: createSettingsPort(resolveSettingsFile(xdg)),
    editor: createEditorPort(),
    healthProbe: createHttpHealthProbe(),
    // `registry clean`'s prompt gate: only true when a y/N answer can be read back (see main.ts).
    isTTY: interactive,
    scanner: routeExplorer.scanner,
    auth: routeExplorer.auth,
    savedRequests,
    install: { installer: createInstallerPort(), nodeVersion: process.version, env: process.env, homedir: homedir(), dataDir: xdg.dataDir },
  });
}
