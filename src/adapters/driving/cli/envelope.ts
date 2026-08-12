// adapters/driving/cli/envelope: the one place that turns a core Result<T> into what the
// CLI actually prints (AD-3). stdout is a TTY -> human-readable text; not a TTY -> exactly
// one final JSON line. Every subcommand outcome (success, expected failure, unknown
// subcommand, caught exception) flows through this single function — one output contract,
// no per-command formatting divergence.
import type { Result } from '../../../core/result.js';

export interface RenderedResult {
  output: string;
  exitCode: 0 | 1;
}

export function renderResult(result: Result<unknown>, isTTY: boolean): RenderedResult {
  const exitCode: 0 | 1 = result.ok ? 0 : 1;
  const output = isTTY ? renderHuman(result) : renderJsonLine(result);
  return { output, exitCode };
}

function renderJsonLine(result: Result<unknown>): string {
  return `${JSON.stringify(result)}\n`;
}

function renderHuman(result: Result<unknown>): string {
  if (result.ok) {
    const hasData = result.data !== null && typeof result.data === 'object' && Object.keys(result.data).length > 0;
    return hasData ? `${JSON.stringify(result.data, null, 2)}\n` : 'OK\n';
  }

  const { code, message, details } = result.error;
  let text = `Error: ${message} (code: ${code})\n`;
  if (details !== undefined) {
    text += `${JSON.stringify(details, null, 2)}\n`;
  }
  return text;
}
