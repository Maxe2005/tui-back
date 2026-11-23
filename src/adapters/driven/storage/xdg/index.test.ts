import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';

// node:fs's ESM namespace can't be spied on directly with vi.spyOn ("Module namespace is
// not configurable in ESM"), so mock the module itself, keeping real behavior for every
// export but wrapping the fs calls that would indicate a filesystem touch — both writes and
// reads — so a future edit that reaches for e.g. readFileSync/statSync can't silently break
// resolveXdgPaths()'s "pure, side-effect-free" contract unnoticed.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    mkdirSync: vi.fn(actual.mkdirSync),
    existsSync: vi.fn(actual.existsSync),
    writeFileSync: vi.fn(actual.writeFileSync),
    readFileSync: vi.fn(actual.readFileSync),
    statSync: vi.fn(actual.statSync),
    accessSync: vi.fn(actual.accessSync),
    readdirSync: vi.fn(actual.readdirSync),
  };
});

const fs = await import('node:fs');
const { resolveXdgPaths, ensureXdgDir } = await import('./index.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolveXdgPaths', () => {
  it('uses $XDG_*_HOME/tui-back when XDG_CONFIG_HOME/XDG_DATA_HOME/XDG_STATE_HOME are set', () => {
    const fakeConfig = path.join(os.tmpdir(), 'fake-config');
    const fakeData = path.join(os.tmpdir(), 'fake-data');
    const fakeState = path.join(os.tmpdir(), 'fake-state');
    const fakeCache = path.join(os.tmpdir(), 'fake-cache');

    const result = resolveXdgPaths(
      {
        XDG_CONFIG_HOME: fakeConfig,
        XDG_DATA_HOME: fakeData,
        XDG_STATE_HOME: fakeState,
        XDG_CACHE_HOME: fakeCache,
      },
      '/home/fake-user',
    );

    expect(result.configDir).toBe(path.join(fakeConfig, 'tui-back'));
    expect(result.dataDir).toBe(path.join(fakeData, 'tui-back'));
    expect(result.stateDir).toBe(path.join(fakeState, 'tui-back'));
    expect(result.cacheDir).toBe(path.join(fakeCache, 'tui-back'));
  });

  it('falls back to the XDG-specified defaults when none are set', () => {
    const fakeHome = '/home/fake-user';

    const result = resolveXdgPaths({}, fakeHome);

    expect(result.configDir).toBe(path.join(fakeHome, '.config', 'tui-back'));
    expect(result.dataDir).toBe(path.join(fakeHome, '.local', 'share', 'tui-back'));
    expect(result.stateDir).toBe(path.join(fakeHome, '.local', 'state', 'tui-back'));
    expect(result.cacheDir).toBe(path.join(fakeHome, '.cache', 'tui-back'));
  });

  it('treats an empty XDG env var as not set and falls back to the default', () => {
    const fakeHome = '/home/fake-user';

    const result = resolveXdgPaths(
      {
        XDG_CONFIG_HOME: '',
        XDG_DATA_HOME: '',
        XDG_STATE_HOME: '',
        XDG_CACHE_HOME: '',
      },
      fakeHome,
    );

    expect(result.configDir).toBe(path.join(fakeHome, '.config', 'tui-back'));
    expect(result.dataDir).toBe(path.join(fakeHome, '.local', 'share', 'tui-back'));
    expect(result.stateDir).toBe(path.join(fakeHome, '.local', 'state', 'tui-back'));
    expect(result.cacheDir).toBe(path.join(fakeHome, '.cache', 'tui-back'));
  });

  it('treats a relative XDG env var as invalid and falls back to the default', () => {
    const fakeHome = '/home/fake-user';

    const result = resolveXdgPaths(
      {
        XDG_CONFIG_HOME: 'foo/bar',
        XDG_DATA_HOME: 'relative/data',
        XDG_STATE_HOME: 'relative/state',
        XDG_CACHE_HOME: 'relative/cache',
      },
      fakeHome,
    );

    expect(result.configDir).toBe(path.join(fakeHome, '.config', 'tui-back'));
    expect(result.dataDir).toBe(path.join(fakeHome, '.local', 'share', 'tui-back'));
    expect(result.stateDir).toBe(path.join(fakeHome, '.local', 'state', 'tui-back'));
    expect(result.cacheDir).toBe(path.join(fakeHome, '.cache', 'tui-back'));
  });

  it('resolves cacheDir without ever touching the filesystem', () => {
    const result = resolveXdgPaths({}, '/home/fake-user');

    expect(result.cacheDir).toBe(path.join('/home/fake-user', '.cache', 'tui-back'));
    expect(fs.mkdirSync).not.toHaveBeenCalled();
    expect(fs.existsSync).not.toHaveBeenCalled();
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(fs.readFileSync).not.toHaveBeenCalled();
    expect(fs.statSync).not.toHaveBeenCalled();
    expect(fs.accessSync).not.toHaveBeenCalled();
    expect(fs.readdirSync).not.toHaveBeenCalled();
  });

  it('resolves configDir/dataDir/stateDir from their defaults when only XDG_CONFIG_HOME is overridden', () => {
    const fakeHome = '/home/fake-user';
    const fakeConfig = path.join(os.tmpdir(), 'only-config-override');

    const result = resolveXdgPaths({ XDG_CONFIG_HOME: fakeConfig }, fakeHome);

    expect(result.configDir).toBe(path.join(fakeConfig, 'tui-back'));
    expect(result.dataDir).toBe(path.join(fakeHome, '.local', 'share', 'tui-back'));
    expect(result.stateDir).toBe(path.join(fakeHome, '.local', 'state', 'tui-back'));
    expect(result.cacheDir).toBe(path.join(fakeHome, '.cache', 'tui-back'));
  });
});

describe('ensureXdgDir', () => {
  let tmpRoot: string;

  afterEach(() => {
    if (tmpRoot) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('creates the directory (and missing parents) when it does not exist yet', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-back-xdg-test-'));
    const target = path.join(tmpRoot, 'nested', 'dir');

    expect(fs.existsSync(target)).toBe(false);

    ensureXdgDir(target);

    expect(fs.existsSync(target)).toBe(true);
  });

  it('is idempotent — calling it again on the same path does not throw', () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tui-back-xdg-test-'));
    const target = path.join(tmpRoot, 'nested', 'dir');

    ensureXdgDir(target);
    expect(() => ensureXdgDir(target)).not.toThrow();
    expect(fs.existsSync(target)).toBe(true);
  });
});
