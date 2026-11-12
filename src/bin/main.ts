// CLI entrypoint: builds the production subcommand registry (wiring lives in composition.ts)
// and hands argv to the dispatcher. No explicit process.exit():
// calling it right after stdout.write() does not guarantee the write is flushed when stdout
// is a pipe, so exitCode is set and the script ends naturally.
import { runCli } from '../adapters/driving/cli/dispatch.js';
import { composeSubcommands } from './composition.js';

// isTTY (stdout-only) governs output rendering (human text vs. one JSON line). The
// interactive-prompt gate `registry clean` uses is stricter — can a y/N answer be read back?
// — so it also requires stdin to be a TTY: piped stdin with a TTY stdout (e.g. a wrapper
// script) must never let the CLI block on, or misread, an `rl.question()` prompt.
const isTTY = process.stdout.isTTY === true;
const subcommands = composeSubcommands({ interactive: isTTY && process.stdin.isTTY === true });

const { output, exitCode } = await runCli(process.argv.slice(2), subcommands, isTTY);
process.stdout.write(output);
process.exitCode = exitCode;
