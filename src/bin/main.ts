// CLI entrypoint (AD-2/AD-3): the one umbrella binary's composition root. Builds the
// production subcommand registry from the driven ports (RegistryPort over the XDG-resolved
// registry.yaml, ManifestPort over loadManifest) and hands argv off to the dispatcher —
// the same mechanism every subcommand plugs into (AD-2), and the same use-cases a future
// TUI will call in-process.
//
// No explicit process.exit() here: calling it right after stdout.write() does not
// guarantee the write is flushed when stdout is a pipe/non-TTY. Setting exitCode and
// letting the script end naturally lets Node drain stdout before exiting.
import { runCli } from '../adapters/driving/cli/dispatch.js';
import { buildSubcommands } from '../adapters/driving/cli/subcommands.js';
import { loadManifest } from '../adapters/driven/manifest/index.js';
import { createRegistryPort, resolveRegistryFile } from '../adapters/driven/registry/index.js';
import { resolveXdgPaths } from '../adapters/driven/xdg/index.js';

const registryFile = resolveRegistryFile(resolveXdgPaths());
const registry = createRegistryPort(registryFile);
const manifest = { load: loadManifest };
const subcommands = buildSubcommands({ registry, manifest });

const { output, exitCode } = await runCli(
  process.argv.slice(2),
  subcommands,
  process.stdout.isTTY === true,
);
process.stdout.write(output);
process.exitCode = exitCode;
