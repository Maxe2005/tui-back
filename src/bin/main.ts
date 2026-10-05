// CLI entrypoint: the umbrella binary's composition root. Builds the production subcommand
// registry from the driven ports and hands argv to the dispatcher. No explicit process.exit():
// calling it right after stdout.write() does not guarantee the write is flushed when stdout
// is a pipe, so exitCode is set and the script ends naturally.
import { join } from 'node:path';
import { runCli } from '../adapters/driving/cli/dispatch.js';
import { buildSubcommands } from '../adapters/driving/cli/subcommands.js';
import { loadManifest } from '../adapters/driven/manifest/index.js';
import { createContainerPort } from '../adapters/driven/container/index.js';
import { createMigrationPort } from '../adapters/driven/migration/index.js';
import { createRestartPort } from '../adapters/driven/restart/index.js';
import { createLockPort } from '../adapters/driven/lock/index.js';
import { createGitPort } from '../adapters/driven/git/index.js';
import { createRegistryPort, resolveRegistryFile } from '../adapters/driven/registry/index.js';
import { createEdtRegistryPort, resolveEdtRegistryFile } from '../adapters/driven/edt-registry/index.js';
import { createStatePort, resolveStateFile } from '../adapters/driven/state/index.js';
import { resolveXdgPaths } from '../adapters/driven/xdg/index.js';
import { moduleRegistry, resolveModule } from '../adapters/driven/modules/module-registry.js';
import { ROUTES_MODULE_ID } from '../core/edt/resolve-tab-visibility.js';

const xdg = resolveXdgPaths();
const registryFile = resolveRegistryFile(xdg);
const registry = createRegistryPort(registryFile);
const manifest = { load: loadManifest };
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

// Per-resource advisory lock directory under XDG_STATE_HOME/tui-back/locks. The lock adapter
// creates it lazily on first acquire, so read-only commands never write state and an
// unwritable state dir surfaces as a Result error rather than a startup crash. The registry
// file path is the resource key register/reset lock on, so concurrent CLI runs serialize
// instead of racing the read-modify-write; `edt create` locks on the EDT registry file.
const lockDir = join(xdg.stateDir, 'locks');
const lock = createLockPort(lockDir);
// isTTY (stdout-only) governs output rendering (human text vs. one JSON line). The
// interactive-prompt gate `registry clean` uses is stricter — can a y/N answer be read back?
// — so it also requires stdin to be a TTY: piped stdin with a TTY stdout (e.g. a wrapper
// script) must never let the CLI block on, or misread, an `rl.question()` prompt.
const isTTY = process.stdout.isTTY === true;
const interactiveIsTTY = isTTY && process.stdin.isTTY === true;
// The route-explorer module's scanner, resolved out of the statically compiled module registry
// by manifest module id (AD-5) — manifests only select this key, never supply code. The lookup
// cannot fail in practice (registry and key are compiled together); the throw is a loud
// programmer-error signal, raised before any stdout output so the envelope is unaffected.
const routeExplorer = resolveModule(moduleRegistry, ROUTES_MODULE_ID);
if (routeExplorer === undefined) {
  throw new Error(`${ROUTES_MODULE_ID} module is not registered`);
}
// The fire-request use-case needs the module's auth port alongside its scanner — same
// static-registry reasoning as the scanner lookup above.
if (routeExplorer.auth === undefined) {
  throw new Error(`${ROUTES_MODULE_ID} auth module is not registered`);
}
const subcommands = buildSubcommands({
  registry,
  manifest,
  lock,
  registryResourceKey: registryFile,
  edtsBaseDir,
  edtRegistry,
  edtRegistryResourceKey: edtRegistryFile,
  git,
  container,
  migration,
  restart,
  state,
  isTTY: interactiveIsTTY,
  scanner: routeExplorer.scanner,
  auth: routeExplorer.auth,
});

const { output, exitCode } = await runCli(process.argv.slice(2), subcommands, isTTY);
process.stdout.write(output);
process.exitCode = exitCode;
