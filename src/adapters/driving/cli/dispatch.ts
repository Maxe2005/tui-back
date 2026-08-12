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
    result = err('internal-error', String(error));
  }

  return renderResult(result, isTTY);
}
