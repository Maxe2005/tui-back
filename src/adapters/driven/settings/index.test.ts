// adapters/driven/settings: integration tests against real temp dirs + real files (AD-13).
// node:fs is deliberately not mocked — this adapter's whole contract is how the real
// filesystem manifests as Result errors/warnings (missing file -> silent defaults, corrupt
// YAML/wrong-shaped settings -> defaults + a non-blocking warning, never an `err` Result) and
// how settings.yaml is persisted.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { DEFAULT_SETTINGS } from '../../../core/ports/settings.js';
import { createSettingsPort, loadSettings, resolveSettingsFile, saveSettings } from './index.js';

const tmpDirs: string[] = [];

function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'tui-back-settings-')).then((dir) => {
    tmpDirs.push(dir);
    return dir;
  });
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) {
      await rm(dir, { recursive: true, force: true });
    }
  }
});

describe('resolveSettingsFile', () => {
  it('derives the settings file path from the XDG config dir', () => {
    expect(resolveSettingsFile({ configDir: '/c', dataDir: '/d', stateDir: '/s', cacheDir: '/k' })).toBe(
      join('/c', 'settings.yaml'),
    );
  });
});

describe('loadSettings', () => {
  it('returns defaults silently when the file is missing (first run)', async () => {
    const root = await tempRoot();

    const result = await loadSettings(join(root, 'nope.yaml'));

    expect(result).toEqual({ ok: true, data: { settings: DEFAULT_SETTINGS, warning: null } });
  });

  it('returns defaults silently for an empty file', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, '');

    const result = await loadSettings(file);

    expect(result).toEqual({ ok: true, data: { settings: DEFAULT_SETTINGS, warning: null } });
  });

  it('loads a valid settings file and exposes its values as-is (AC3)', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(
      file,
      'commandPalette:\n  gridMaxRows: 12\nedts:\n  hiddenActionHints:\n    - edt-services\n',
    );

    const result = await loadSettings(file);

    expect(result).toEqual({
      ok: true,
      data: {
        settings: { commandPalette: { gridMaxRows: 12 }, edts: { hiddenActionHints: ['edt-services'] } },
        warning: null,
      },
    });
  });

  it('falls back to defaults with a non-blocking warning on invalid YAML — never an err Result', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'a: [unclosed');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toMatch(/Invalid YAML/);
  });

  it('falls back to defaults with a field-naming warning on a zod validation failure — never an err Result', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'commandPalette:\n  gridMaxRows: "not-a-number"\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('commandPalette.gridMaxRows');
  });

  it('falls back to defaults with a field-naming warning when gridMaxRows exceeds the upper bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'commandPalette:\n  gridMaxRows: 100\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('commandPalette.gridMaxRows');
  });

  it('falls back to defaults with a warning on an unknown top-level field (strict schema)', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'nope: true\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).not.toBeNull();
  });

  it('reports a genuine I/O error (not ENOENT) as an err Result', async () => {
    const root = await tempRoot();
    const dirNotFile = join(root, 'settings.yaml');
    await mkdir(dirNotFile); // reading a directory as a file fails with EISDIR, not ENOENT

    const result = await loadSettings(dirNotFile);

    expect(result).toMatchObject({ ok: false, error: { code: 'settings-read-error' } });
  });
});

describe('saveSettings', () => {
  it('creates the config dir and persists the settings as YAML', async () => {
    const root = await tempRoot();
    const file = join(root, 'tui-back', 'settings.yaml');
    const settings = { commandPalette: { gridMaxRows: 10 }, edts: { hiddenActionHints: ['other-services'] } };

    const result = await saveSettings(file, settings);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(parse(await readFile(file, 'utf8'))).toEqual(settings);
  });

  it('overwrites a previously-saved file with the new value (no separate save step, AC3)', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await saveSettings(file, DEFAULT_SETTINGS);

    await saveSettings(file, { commandPalette: { gridMaxRows: 20 }, edts: { hiddenActionHints: [] } });

    expect(parse(await readFile(file, 'utf8'))).toEqual({
      commandPalette: { gridMaxRows: 20 },
      edts: { hiddenActionHints: [] },
    });
  });
});

describe('createSettingsPort', () => {
  it('round-trips a save then a load through the same file', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    const port = createSettingsPort(file);
    const settings = { commandPalette: { gridMaxRows: 5 }, edts: { hiddenActionHints: ['edts'] } };

    await port.save(settings);
    const result = await port.load();

    expect(result).toEqual({ ok: true, data: { settings, warning: null } });
  });
});
