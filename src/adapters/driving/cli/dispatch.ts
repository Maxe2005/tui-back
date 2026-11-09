// adapters/driving/cli/dispatch: resolves argv to a registered subcommand and always
// produces a rendered {output, exitCode} — never lets an exception escape uncaught, and
// treats "no subcommand"/"unknown subcommand"/"--help" as just another Result, routed
// through the same renderResult() as every other outcome (AD-3's "one output contract").
import { ok, err, type Result } from '../../../core/result.js';
import { renderResult, type RenderedResult } from './envelope.js';

export interface Subcommand {
  name: string;
  /** One-line usage string shown by `--help`, e.g. "tui-back register <path>". */
  usage: string;
  run: (args: string[]) => Promise<Result<unknown>>;
}

export interface HelpData {
  usage: string;
  commands: Array<{ name: string; usage: string }>;
}

function buildHelp(subcommands: Subcommand[]): HelpData {
  return {
    usage: 'tui-back <command> [args]',
    commands: [
      ...subcommands.map((candidate) => ({ name: candidate.name, usage: candidate.usage })),
      // `tui` is routed by the bin shim, not the subcommand registry, so it is listed statically.
      { name: 'tui', usage: 'tui-back tui' },
    ],
  };
}

export async function runCli(
  argv: string[],
  subcommands: Subcommand[],
  isTTY: boolean,
): Promise<RenderedResult> {
  const [name, ...args] = argv;

  if (name === '--help' || name === '-h') {
    return renderResult(ok(buildHelp(subcommands)), isTTY);
  }

  const subcommand = subcommands.find((candidate) => candidate.name === name);

  if (!subcommand) {
    const available = subcommands.map((candidate) => candidate.name).join(', ');
    const label = name === undefined ? '(none)' : `"${name}"`;
    return renderResult(err('unknown-subcommand', `Unknown subcommand: ${label}. Available: ${available}`), isTTY);
  }

  let result: Result<unknown>;
  try {
    result = await subcommand.run(args);
  } catch (error) {
    // Log the original error/stack to stderr — the envelope's `internal-error` message is
    // just `String(error)`, which loses the stack trace and can collapse to "[object Object]"
    // for non-Error throws. stderr is a separate stream from the AD-3 envelope on stdout, so
    // this doesn't affect the "exactly one JSON line" contract.
    console.error(error);
    result = err('internal-error', String(error));
  }

  // renderResult (specifically JSON.stringify inside it) can itself throw — e.g. a circular
  // reference or a BigInt inside a use-case's returned data. That must never escape as an
  // uncaught exception, so it gets the same try/catch treatment as subcommand.run above.
  try {
    return renderResult(result, isTTY);
  } catch (error) {
    console.error(error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return renderResult(err('internal-error', `Failed to render result: ${errorMsg}`), isTTY);
  }
}
