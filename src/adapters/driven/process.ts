// adapters/driven/process: the one asynchronous subprocess runner shared by every driven
// adapter. `spawnSync` blocks Node's single thread for the whole life of the child, which
// freezes the TUI (no redraw, no keys) during a group update; this resolves the same result
// shape once the child exits while the event loop keeps running. It never rejects — a spawn
// failure (missing binary, bad cwd, invalid arguments) is reported as a null-status result
// with `error`, exactly like `spawnSync`, so adapters keep their Result-envelope handling.
import { spawn } from 'node:child_process';

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  // Aborts the child and reports ETIMEDOUT, like spawnSync's `timeout`.
  timeout?: number;
  // Stdout/stderr byte budget; exceeding it kills the child and reports ENOBUFS (spawnSync's
  // default of 1 MiB applies when omitted).
  maxBuffer?: number;
}

export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

const DEFAULT_MAX_BUFFER = 1024 * 1024;

export function runProcess(command: string, args: readonly string[], options: ProcessOptions = {}): Promise<ProcessResult> {
  return new Promise((resolveResult) => {
    const maxBuffer = options.maxBuffer ?? DEFAULT_MAX_BUFFER;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let size = 0;
    let failure: Error | undefined;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (status: number | null): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      resolveResult({
        status: failure === undefined ? status : null,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        ...(failure === undefined ? {} : { error: failure }),
      });
    };

    let child;
    try {
      child = spawn(command, [...args], {
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
        ...(options.env === undefined ? {} : { env: options.env }),
      });
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      finish(null);
      return;
    }

    const fail = (code: string, message: string): void => {
      if (failure === undefined) {
        failure = Object.assign(new Error(message), { code });
        child.kill('SIGKILL');
        // A grandchild can keep the pipes open after the child dies, which would delay
        // 'close' indefinitely: settle now and drop the pipes.
        child.stdout.destroy();
        child.stderr.destroy();
        finish(null);
      }
    };
    const collect = (chunks: Buffer[]) => (chunk: Buffer): void => {
      size += chunk.length;
      if (size > maxBuffer) {
        fail('ENOBUFS', `${command} output exceeded ${String(maxBuffer)} bytes`);
        return;
      }
      chunks.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.on('error', (error) => {
      failure ??= error;
      finish(null);
    });
    child.on('close', (code) => finish(code));
    if (options.timeout !== undefined) {
      timer = setTimeout(() => fail('ETIMEDOUT', `${command} timed out after ${String(options.timeout)}ms`), options.timeout);
    }
  });
}
