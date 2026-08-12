// CLI entrypoint (AD-2/AD-3): the one umbrella binary's composition root. Builds the
// production subcommand registry and hands argv off to the dispatcher, which is provably
// the same mechanism every future subcommand (Story 1.4+) plugs into.
//
// No explicit process.exit() here: calling it right after stdout.write() does not
// guarantee the write is flushed when stdout is a pipe/non-TTY. Setting exitCode and
// letting the script end naturally lets Node drain stdout before exiting.
import { ping } from '../core/ping.js';
import { runCli, type Subcommand } from '../adapters/driving/cli/dispatch.js';

const subcommands: Subcommand[] = [{ name: 'ping', run: () => ping() }];

const { output, exitCode } = await runCli(
  process.argv.slice(2),
  subcommands,
  process.stdout.isTTY === true,
);
process.stdout.write(output);
process.exitCode = exitCode;
