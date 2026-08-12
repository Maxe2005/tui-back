// adapters/driving/cli/dispatch: resolves argv to a registered subcommand and always
// produces a rendered {output, exitCode} — never lets an exception escape uncaught, and
// treats "no subcommand"/"unknown subcommand" as just another Result, routed through the
// same renderResult() as every other outcome (AD-3's "one output contract").
import { err, type Result } from '../../../core/result.js';
import { renderResult, type RenderedResult } from './envelope.js';

export interface Subcommand {
  name: string;
  run: (args: string[]) => Promise<Result<unknown>>;
}

export async function runCli(
  argv: string[],
  subcommands: Subcommand[],
  isTTY: boolean,
): Promise<RenderedResult> {
  const [name, ...args] = argv;
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
  // uncaught exception (AD-3's whole point), so it gets the same try/catch treatment as
  // subcommand.run above, one level up.
  try {
    return renderResult(result, isTTY);
  } catch (error) {
    console.error(error);
    return renderResult(err('internal-error', `Failed to render result: ${String(error)}`), isTTY);
  }
}
