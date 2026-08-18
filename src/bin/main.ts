// CLI entrypoint (AD-2/AD-3): the one umbrella binary's composition root. Builds the
// production subcommand registry from the driven ports (RegistryPort over the XDG-resolved
// registry.yaml, ManifestPort over loadManifest, EdtRegistryPort over the XDG-resolved
// edts.yaml) and hands argv off to the dispatcher — the same mechanism every subcommand
// plugs into (AD-2), and the same use-cases a future TUI will call in-process.
//
// No explicit process.exit() here: calling it right after stdout.write() does not
// guarantee the write is flushed when stdout is a pipe/non-TTY. Setting exitCode and
// letting the script end naturally lets Node drain stdout before exiting.
import { join } from 'node:path';
import { runCli } from '../adapters/driving/cli/dispatch.js';
import { buildSubcommands } from '../adapters/driving/cli/subcommands.js';
import { loadManifest } from '../adapters/driven/manifest/index.js';
import { createLockPort } from '../adapters/driven/lock/index.js';
import { createGitPort } from '../adapters/driven/git/index.js';
import { createRegistryPort, resolveRegistryFile } from '../adapters/driven/registry/index.js';
import { createEdtRegistryPort, resolveEdtRegistryFile } from '../adapters/driven/edt-registry/index.js';
import { resolveXdgPaths } from '../adapters/driven/xdg/index.js';

const xdg = resolveXdgPaths();
const registryFile = resolveRegistryFile(xdg);
const registry = createRegistryPort(registryFile);
const manifest = { load: loadManifest };
const git = createGitPort({ load: loadManifest });
const edtsBaseDir = join(xdg.dataDir, 'edts');
const edtRegistryFile = resolveEdtRegistryFile(xdg);
const edtRegistry = createEdtRegistryPort(edtRegistryFile);

// Per-resource advisory lock directory lives under XDG_STATE_HOME/tui-back/locks (AD-7's
// transient-state tier). The lock dir is created lazily inside the lock adapter on first
// acquire (only register/reset/edt-create acquire), so read-only commands never write state
// and an unwritable state dir surfaces as a Result error rather than a startup crash. The
// registry file path is the resource key state-mutating use-cases (register/reset) lock on,
// so concurrent CLI runs are serialized instead of racing the registry read-modify-write;
// `edt create` locks on the EDT registry file the same way.
const lockDir = join(xdg.stateDir, 'locks');
const lock = createLockPort(lockDir);
const subcommands = buildSubcommands({
  registry,
  manifest,
  lock,
  registryResourceKey: registryFile,
  edtsBaseDir,
  edtRegistry,
  edtRegistryResourceKey: edtRegistryFile,
  git,
});

const { output, exitCode } = await runCli(process.argv.slice(2), subcommands, process.stdout.isTTY === true);
process.stdout.write(output);
process.exitCode = exitCode;
