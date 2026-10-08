// adapters/driven/modules/shared-types/npm-package: the `shared-types` SharedTypesPort adapter.
// Reads and rewrites a package.json dependency line by targeted text edit (never a JSON
// re-serialisation, so indent, line endings and trailing newline survive) and verifies a
// version on the npm registry by shelling out to `npm view` through an injectable runner.
import { readFile, writeFile } from 'node:fs/promises';
import { err, ok, type Result } from '../../../../core/result.js';
import type { SharedTypesPort } from '../../../../core/ports/shared-types.js';
import { runProcess, type ProcessResult } from '../../process.js';

export interface SharedTypesFs {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

export type RegistryRunner = (
  command: string,
  args: readonly string[],
  options: { timeout: number },
) => Promise<ProcessResult>;

export interface SharedTypesOptions {
  fs?: SharedTypesFs;
  runner?: RegistryRunner;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20000;
const SECTIONS = ['dependencies', 'devDependencies'] as const;

const defaultFs: SharedTypesFs = {
  readFile: (path) => readFile(path, 'utf8'),
  writeFile: (path, content) => writeFile(path, content, 'utf8'),
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function unreadable(path: string, error: unknown): Result<never> {
  const detail = error instanceof Error ? error.message : String(error);
  return err('package-json-unreadable', `Cannot read ${path}: ${detail}`);
}

async function loadPackage(
  fs: SharedTypesFs,
  path: string,
): Promise<Result<{ text: string; json: Record<string, unknown> }>> {
  let text: string;
  try {
    text = await fs.readFile(path);
  } catch (error) {
    return unreadable(path, error);
  }
  try {
    const json: unknown = JSON.parse(text.replace(/^﻿/, ''));
    if (typeof json !== 'object' || json === null || Array.isArray(json)) {
      return unreadable(path, new Error('not a JSON object'));
    }
    return ok({ text, json: json as Record<string, unknown> });
  } catch (error) {
    return unreadable(path, error);
  }
}

function declaredSection(json: Record<string, unknown>, dependency: string): (typeof SECTIONS)[number] | undefined {
  for (const section of SECTIONS) {
    const value = json[section];
    if (
      typeof value === 'object' &&
      value !== null &&
      Object.prototype.hasOwnProperty.call(value, dependency) &&
      typeof (value as Record<string, unknown>)[dependency] === 'string'
    ) {
      return section;
    }
  }
  return undefined;
}

// `npm view pkg@spec version --json` prints a string for one match and an array for several
// (ranges); only an exact match of the requested version counts as published.
function printsExactVersion(stdout: string, version: string): boolean {
  try {
    const parsed: unknown = JSON.parse(stdout.trim());
    return Array.isArray(parsed) ? parsed.includes(version) : parsed === version;
  } catch {
    return false;
  }
}

export function createSharedTypesAdapter(options: SharedTypesOptions = {}): SharedTypesPort {
  const fs = options.fs ?? defaultFs;
  const runner: RegistryRunner = options.runner ?? ((command, args, opts) => runProcess(command, args, opts));
  const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return {
    async readVersion(packageJsonPath, dependency) {
      const loaded = await loadPackage(fs, packageJsonPath);
      if (!loaded.ok) {
        return loaded;
      }
      const section = declaredSection(loaded.data.json, dependency);
      if (section === undefined) {
        return err('dependency-not-found', `${dependency} is not declared in ${packageJsonPath}`);
      }
      return ok((loaded.data.json[section] as Record<string, string>)[dependency] as string);
    },

    async writeVersionLine(packageJsonPath, dependency, version) {
      const loaded = await loadPackage(fs, packageJsonPath);
      if (!loaded.ok) {
        return loaded;
      }
      const { text, json } = loaded.data;
      const section = declaredSection(json, dependency);
      if (section === undefined) {
        return err('dependency-not-found', `${dependency} is not declared in ${packageJsonPath}`);
      }
      // Locate the section's object body in the raw text (it holds only string values, so the
      // first closing brace ends it), then replace just the value inside it.
      const header = new RegExp(`"${section}"\\s*:\\s*\\{`).exec(text);
      if (header === null) {
        return unreadable(packageJsonPath, new Error(`cannot locate "${section}" block`));
      }
      const bodyStart = header.index + header[0].length;
      const bodyEnd = text.indexOf('}', bodyStart);
      const body = text.slice(bodyStart, bodyEnd === -1 ? text.length : bodyEnd);
      const line = new RegExp(`("${escapeRegExp(JSON.stringify(dependency).slice(1, -1))}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`);
      if (!line.test(body)) {
        return unreadable(packageJsonPath, new Error(`cannot locate the ${dependency} line`));
      }
      const newBody = body.replace(line, (_match, prefix: string) => `${prefix}${JSON.stringify(version)}`);
      const updated = text.slice(0, bodyStart) + newBody + text.slice(bodyStart + body.length);
      try {
        await fs.writeFile(packageJsonPath, updated);
      } catch (error) {
        return unreadable(packageJsonPath, error);
      }
      return ok(undefined);
    },

    async verifyPublished(packageName, version) {
      const result = await runner('npm', ['view', `${packageName}@${version}`, 'version', '--json'], { timeout });
      if (result.error !== undefined || result.status === null) {
        const reason = result.error?.message ?? 'npm did not complete';
        return err('registry-unreachable', `Cannot reach the npm registry for ${packageName}@${version}: ${reason}`);
      }
      if (result.status === 0) {
        return ok(printsExactVersion(result.stdout, version));
      }
      if (/\bE404\b|404 Not Found|code"?:\s*"?E404/i.test(`${result.stdout}\n${result.stderr}`)) {
        return ok(false);
      }
      const detail = result.stderr.trim().split('\n')[0] ?? '';
      return err(
        'registry-unreachable',
        `npm view ${packageName}@${version} failed (exit ${String(result.status)})${detail === '' ? '' : `: ${detail}`}`,
      );
    },
  };
}
