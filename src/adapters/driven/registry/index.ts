// adapters/driven/registry: the driven implementation of core's RegistryPort (AD-6).
// Persists managed local paths to XDG_CONFIG_HOME/tui-back/registry.yaml (reusing Story
// 1.2's XDG resolution + ensureXdgDir), owns the filesystem existence probe listRepos
// uses to separate unreachable from unmanaged, and walks a root to propose scan
// candidates. It only ever proposes on scan — never auto-registers.
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { err, ok, type Result } from '../../../core/result.js';
import type { RegistryPort } from '../../../core/ports/registry.js';
import type { XdgPaths } from '../xdg/index.js';
import { ensureXdgDir } from '../xdg/index.js';
import { registrySchema } from './schema.js';

const MANIFEST_FILE = '.tui-back.yaml';
const SKIP_DIRS = new Set(['node_modules']);

export function resolveRegistryFile(xdg: XdgPaths): string {
  return join(xdg.configDir, 'registry.yaml');
}

export function createRegistryPort(registryFile: string): RegistryPort {
  return {
    list: () => listRegistry(registryFile),
    add: (path) => addRegistry(registryFile, path),
    exists: (path) => registryPathExists(path),
    scan: (root) => scanRoot(root),
  };
}

export async function listRegistry(registryFile: string): Promise<Result<string[]>> {
  let content: string;
  try {
    content = await readFile(registryFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok([]);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-read-error', `Failed to read registry file ${registryFile}: ${detail}`);
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-invalid-yaml', `Invalid YAML in ${registryFile}: ${detail}`);
  }

  const result = registrySchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first ? (first.path.length > 0 ? first.path.join('.') : '(root)') : '<unknown>';
    const reason = first ? first.message : 'unknown validation error';
    return err('registry-invalid-format', `Invalid registry file ${registryFile}: ${field} — ${reason}`, {
      issues: result.error.issues,
    });
  }

  return ok(result.data.repos);
}

export async function addRegistry(registryFile: string, path: string): Promise<Result<void>> {
  ensureXdgDir(dirname(registryFile));

  const listed = await listRegistry(registryFile);
  if (!listed.ok) {
    return listed;
  }
  if (listed.data.includes(path)) {
    return ok(undefined);
  }

  try {
    await writeFile(registryFile, stringify({ repos: [...listed.data, path] }), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-write-error', `Failed to write registry file ${registryFile}: ${detail}`);
  }
  return ok(undefined);
}

export async function registryPathExists(path: string): Promise<Result<boolean>> {
  try {
    await stat(path);
    return ok(true);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok(false);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-stat-error', `Failed to stat ${path}: ${detail}`);
  }
}

export async function scanRoot(root: string): Promise<Result<string[]>> {
  let rootStat;
  try {
    rootStat = await stat(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return err('scan-root-not-found', `Scan root not found: ${root}`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('scan-root-error', `Failed to stat scan root ${root}: ${detail}`);
  }
  if (!rootStat.isDirectory()) {
    return err('scan-root-not-found', `Scan root is not a directory: ${root}`);
  }

  const candidates: string[] = [];
  await walkForManifests(root, candidates);
  candidates.sort();
  return ok(candidates);
}

async function walkForManifests(dir: string, candidates: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  let carriesManifest = false;
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILE) {
      carriesManifest = true;
      continue;
    }
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walkForManifests(join(dir, entry.name), candidates);
    }
  }
  if (carriesManifest) {
    candidates.push(dir);
  }
}
