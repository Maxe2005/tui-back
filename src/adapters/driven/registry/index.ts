// adapters/driven/registry: the driven implementation of core's RegistryPort (AD-6).
// Persists managed local paths to XDG_CONFIG_HOME/tui-back/registry.yaml (reusing Story
// 1.2's XDG resolution + ensureXdgDir), owns the filesystem existence probe listRepos
// uses to separate unreachable from unmanaged, and walks a root to propose scan
// candidates. It only ever proposes on scan — never auto-registers.
import { copyFile, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parse, stringify } from 'yaml';
import { err, ok, type Result } from '../../../core/result.js';
import type { RegistryPort, ResetResult, ScanResult } from '../../../core/ports/registry.js';
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
    reset: (path) => resetRegistry(registryFile, path),
  };
}

async function ensureRegistryDir(registryFile: string): Promise<Result<void>> {
  try {
    ensureXdgDir(dirname(registryFile));
    return ok(undefined);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-write-error', `Failed to create registry directory ${dirname(registryFile)}: ${detail}`);
  }
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
  const trimmed = content.trim();
  if (trimmed === '') {
    return ok([]);
  }
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
  const ensured = await ensureRegistryDir(registryFile);
  if (!ensured.ok) {
    return ensured;
  }

  const canonical = resolve(path);
  const listed = await listRegistry(registryFile);
  if (!listed.ok) {
    return listed;
  }
  if (listed.data.includes(canonical)) {
    return ok(undefined);
  }

  try {
    await writeFile(registryFile, stringify({ repos: [...listed.data, canonical] }), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-write-error', `Failed to write registry file ${registryFile}: ${detail}`);
  }
  return ok(undefined);
}

export async function resetRegistry(registryFile: string, path: string): Promise<Result<ResetResult>> {
  const ensured = await ensureRegistryDir(registryFile);
  if (!ensured.ok) {
    return ensured;
  }

  let content: string;
  try {
    content = await readFile(registryFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      try {
        await writeFile(registryFile, stringify({ repos: [path] }), 'utf8');
      } catch (writeError) {
        const detail = writeError instanceof Error ? writeError.message : String(writeError);
        return err('registry-write-error', `Failed to write registry file ${registryFile}: ${detail}`);
      }
      return ok({ path, backupPath: null });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-read-error', `Failed to read registry file ${registryFile}: ${detail}`);
  }

  let healthy: boolean;
  try {
    healthy = registrySchema.safeParse(parse(content)).success;
  } catch {
    healthy = false;
  }
  if (healthy) {
    return err('registry-not-corrupt', `Registry file ${registryFile} is valid — nothing to reset. Use "register" to add a path.`);
  }

  const backupPath = `${registryFile}.bak-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    await copyFile(registryFile, backupPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-write-error', `Failed to back up corrupt registry to ${backupPath}: ${detail}`);
  }

  try {
    await writeFile(registryFile, stringify({ repos: [path] }), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-write-error', `Failed to write registry file ${registryFile}: ${detail}`);
  }
  return ok({ path, backupPath });
}

export async function registryPathExists(path: string): Promise<Result<boolean>> {
  let pathStat;
  try {
    pathStat = await stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return ok(false);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('registry-stat-error', `Failed to stat ${path}: ${detail}`);
  }
  // Only a directory is a plausible managed-repo location — a regular file is not an
  // unmanaged repo, so report it unreachable rather than silently skipping it.
  return ok(pathStat.isDirectory());
}

export async function scanRoot(root: string): Promise<Result<ScanResult>> {
  const resolvedRoot = resolve(root);
  let rootStat;
  try {
    rootStat = await stat(resolvedRoot);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return err('scan-root-not-found', `Scan root not found: ${resolvedRoot}`);
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('scan-root-error', `Failed to stat scan root ${resolvedRoot}: ${detail}`);
  }
  if (!rootStat.isDirectory()) {
    return err('scan-root-not-found', `Scan root is not a directory: ${resolvedRoot}`);
  }

  const candidates: string[] = [];
  const skipped: string[] = [];
  await walkForManifests(resolvedRoot, candidates, skipped);
  candidates.sort();
  skipped.sort();
  return ok({ candidates, skipped });
}

async function walkForManifests(dir: string, candidates: string[], skipped: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // An unreadable subtree is reported, not silently dropped — its directory lands in
    // `skipped` so the caller can surface it (AD-3: errors surface, never hide).
    skipped.push(dir);
    return;
  }

  let carriesManifest = false;
  for (const entry of entries) {
    if (entry.name === MANIFEST_FILE && entry.isFile()) {
      carriesManifest = true;
      continue;
    }
    if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) {
      continue;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      await walkForManifests(join(dir, entry.name), candidates, skipped);
    }
  }
  if (carriesManifest) {
    candidates.push(dir);
  }
}
