// adapters/driven/xdg: resolves the tool's config/data/state/cache directories per the
// XDG Base Directory Specification v0.8. Lives in adapters/driven/, not core/ — AD-1
// forbids core/ from importing fs, and os.homedir()/process.env plus the directory
// creation in ensureXdgDir() are adapter-layer infrastructure, not a core concern.
import { mkdirSync } from 'node:fs';
import { homedir as osHomedir } from 'node:os';
import { join, isAbsolute } from 'node:path';

const APP_DIR_NAME = 'tui-back';

export interface XdgPaths {
  configDir: string;
  dataDir: string;
  stateDir: string;
  cacheDir: string;
}

/**
 * Resolves an XDG base directory env var per the spec: an env var is treated as "not set" —
 * i.e. falls through to the default — when it is unset, empty, or not an absolute path
 * ("If an implementation encounters a relative path in any of these variables, it should
 * consider the path invalid and ignore it").
 */
function resolveXdgBase(envValue: string | undefined, defaultBase: string): string {
  if (envValue && isAbsolute(envValue)) {
    return envValue;
  }
  return defaultBase;
}

/**
 * Pure, side-effect-free resolution of tui-back's XDG-namespaced storage directories.
 * Accepts env/homedir as parameters (rather than reading process.env/os.homedir()
 * internally) so it is testable without mutating real process state.
 */
export function resolveXdgPaths(
  env: NodeJS.ProcessEnv = process.env,
  homedir: string = osHomedir(),
): XdgPaths {
  const configBase = resolveXdgBase(env.XDG_CONFIG_HOME, join(homedir, '.config'));
  const dataBase = resolveXdgBase(env.XDG_DATA_HOME, join(homedir, '.local', 'share'));
  const stateBase = resolveXdgBase(env.XDG_STATE_HOME, join(homedir, '.local', 'state'));
  const cacheBase = resolveXdgBase(env.XDG_CACHE_HOME, join(homedir, '.cache'));

  return {
    configDir: join(configBase, APP_DIR_NAME),
    dataDir: join(dataBase, APP_DIR_NAME),
    stateDir: join(stateBase, APP_DIR_NAME),
    cacheDir: join(cacheBase, APP_DIR_NAME),
  };
}

/**
 * Creates dirPath (and any missing parents) if it doesn't exist yet. Not called
 * automatically by resolveXdgPaths() — creation happens on demand, right before a
 * future adapter (persistence, registry, manifest) writes a file under it.
 */
export function ensureXdgDir(dirPath: string): void {
  mkdirSync(dirPath, { recursive: true });
}
