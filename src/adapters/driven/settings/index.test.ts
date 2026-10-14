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

  it('loads a valid settings file and exposes its values as-is', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(
      file,
      'commandPalette:\n  gridMaxRows: 12\nedts:\n  hiddenActionHints:\n    - edt-services\n  hiddenActionTypes:\n    - modify\n',
    );

    const result = await loadSettings(file);

    expect(result).toEqual({
      ok: true,
      data: {
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 12, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: ['edt-services'], hiddenActionTypes: ['modify'], branchDropdownMaxRows: 5 },
          update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
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

  it.each([
    ['historySize: 201', 'commandPalette.historySize'],
    ['historySize: 0', 'commandPalette.historySize'],
    ['historyDedup: "x"', 'commandPalette.historyDedup'],
  ])('falls back to defaults with a field-naming warning for commandPalette %s', async (line, field) => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, `commandPalette:\n  gridMaxRows: 8\n  ${line}\n`);

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain(field);
  });

  it('falls back to defaults with a field-naming warning when logs.bufferSize exceeds the upper bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 5001\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('logs.bufferSize');
  });

  it('falls back to defaults with a field-naming warning when logs.bufferSize is below the lower bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 49\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('logs.bufferSize');
  });

  it('falls back to defaults with a field-naming warning when logs.bufferSize is not an integer', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 1.5\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('logs.bufferSize');
  });

  // Mirrors the logs.bufferSize bound tests above for filterHistorySize/filterHistoryGridMaxRows.
  it('falls back to defaults with a field-naming warning when logs.filterHistorySize exceeds the upper bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 500\n  filterHistorySize: 201\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('logs.filterHistorySize');
  });

  it('falls back to defaults with a field-naming warning when logs.filterHistorySize is below the lower bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 500\n  filterHistorySize: 0\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('logs.filterHistorySize');
  });

  it('falls back to defaults with a field-naming warning when logs.filterHistoryGridMaxRows exceeds the upper bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 500\n  filterHistoryGridMaxRows: 100\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('logs.filterHistoryGridMaxRows');
  });

  it('loads a pre-existing file whose logs block predates filterHistorySize/filterHistoryGridMaxRows — defaults just those fields, keeps bufferSize', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 750\n');

    const result = await loadSettings(file);

    expect(result).toEqual({
      ok: true,
      data: {
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3 }, logs: { bufferSize: 750, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
        warning: null,
      },
    });
  });

  it('keeps the rest of the file and falls back to simple when logs.restartMode is not simple|clean', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 750\n  restartMode: bogus\n');

    const result = await loadSettings(file);

    expect(result.ok && result.data.settings.logs).toEqual({
      bufferSize: 750,
      startWithHistory: false,
      filterHistorySize: 20,
      filterHistoryGridMaxRows: 8,
      filterHistoryDedup: true,
      restartMode: 'simple',
    });
  });

  it('reads logs.restartMode: clean', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 500\n  restartMode: clean\n');

    const result = await loadSettings(file);

    expect(result.ok && result.data.settings.logs.restartMode).toBe('clean');
  });

  it('falls back to defaults with a field-naming warning when general.quitShortcutEnabled is not a boolean', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'general:\n  quitShortcutEnabled: "nope"\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('general.quitShortcutEnabled');
  });

  it('loads general.editorCommand as-is, and defaults it to empty for a general block written before the field existed', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'general:\n  editorCommand: code <repo>\n');

    const configured = await loadSettings(file);

    expect(configured.ok).toBe(true);
    if (!configured.ok) throw new Error('expected ok');
    expect(configured.data.settings.general).toEqual({ quitShortcutEnabled: true, editorCommand: 'code <repo>' });
    expect(configured.data.warning).toBeNull();

    await writeFile(file, 'general:\n  quitShortcutEnabled: false\n');

    const legacy = await loadSettings(file);

    expect(legacy.ok).toBe(true);
    if (!legacy.ok) throw new Error('expected ok');
    expect(legacy.data.settings.general).toEqual({ quitShortcutEnabled: false, editorCommand: '' });
    expect(legacy.data.warning).toBeNull();
  });

  it('loads update.concurrency, defaults it when the group is absent and rejects an out-of-range value', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'update:\n  concurrency: 4\n');
    const configured = await loadSettings(file);
    expect(configured.ok && configured.data.settings.update).toEqual({ concurrency: 4 });

    await writeFile(file, 'general:\n  quitShortcutEnabled: true\n');
    const legacy = await loadSettings(file);
    expect(legacy.ok && legacy.data.settings.update).toEqual(DEFAULT_SETTINGS.update);

    await writeFile(file, 'update:\n  concurrency: 0\n');
    const invalid = await loadSettings(file);
    expect(invalid.ok && invalid.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(invalid.ok && invalid.data.warning).toContain('update.concurrency');
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

  it('loads a pre-amendment file whose edts block predates hiddenActionTypes — defaults just that field, keeps hiddenActionHints', async () => {
    // A settings.yaml written before hiddenActionTypes existed has an `edts:` block with
    // `hiddenActionHints` only. It must parse (hiddenActionTypes defaulting to []), not fall
    // back to every default — that would discard the developer's hiddenActionHints and even
    // unrelated commandPalette.gridMaxRows customizations on every load.
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'commandPalette:\n  gridMaxRows: 15\nedts:\n  hiddenActionHints:\n    - edts\n');

    const result = await loadSettings(file);

    expect(result).toEqual({
      ok: true,
      data: {
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 15, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: ['edts'], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
        warning: null,
      },
    });
  });

  it('loads a pre-existing file whose edts block predates branchDropdownMaxRows — defaults just that field, keeps hiddenActionHints', async () => {
    // A settings.yaml written before this field existed has an `edts:` block without
    // `branchDropdownMaxRows` at all. Mirrors the hiddenActionTypes precedent just above: must
    // default branchDropdownMaxRows to 5 rather than falling back to every default (which would
    // silently discard the developer's existing customizations).
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'commandPalette:\n  gridMaxRows: 15\nedts:\n  hiddenActionHints:\n    - edts\n');

    const result = await loadSettings(file);

    expect(result).toEqual({
      ok: true,
      data: {
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 15, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: ['edts'], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
        warning: null,
      },
    });
  });

  it('loads a valid edts.branchDropdownMaxRows value as-is', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'edts:\n  branchDropdownMaxRows: 12\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings.edts.branchDropdownMaxRows).toBe(12);
    expect(result.data.warning).toBeNull();
  });

  it('falls back to defaults with a field-naming warning when edts.branchDropdownMaxRows exceeds the upper bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'edts:\n  branchDropdownMaxRows: 21\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('edts.branchDropdownMaxRows');
  });

  it('falls back to defaults with a field-naming warning when edts.branchDropdownMaxRows is below the lower bound', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'edts:\n  branchDropdownMaxRows: 0\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('edts.branchDropdownMaxRows');
  });

  it('falls back to defaults with a field-naming warning when edts.branchDropdownMaxRows is not a number', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'edts:\n  branchDropdownMaxRows: "12"\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('edts.branchDropdownMaxRows');
  });

  it('falls back to defaults with a field-naming warning when edts.branchDropdownMaxRows is not an integer', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'edts:\n  branchDropdownMaxRows: 5.5\n');

    const result = await loadSettings(file);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.data.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.data.warning).toContain('edts.branchDropdownMaxRows');
  });

  it('loads a pre-existing file whose logs block predates startWithHistory — defaults just that field, keeps bufferSize', async () => {
    // A settings.yaml written before this field existed has a `logs:` block with `bufferSize`
    // only. Mirrors the hiddenActionTypes precedent just above: must default startWithHistory
    // to false rather than falling back to every default (which would also silently discard
    // the developer's existing bufferSize customization).
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'logs:\n  bufferSize: 750\n');

    const result = await loadSettings(file);

    expect(result).toEqual({
      ok: true,
      data: {
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 8, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3 }, logs: { bufferSize: 750, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
        warning: null,
      },
    });
  });

  it('loads a pre-existing file with no general block — defaults quitShortcutEnabled to true, keeps other fields', async () => {
    // Mirrors the hiddenActionTypes/startWithHistory precedents above: a settings.yaml written
    // before this field existed has no `general:` block at all.
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await writeFile(file, 'commandPalette:\n  gridMaxRows: 12\n');

    const result = await loadSettings(file);

    expect(result).toEqual({
      ok: true,
      data: {
        settings: {
          general: { quitShortcutEnabled: true, editorCommand: '' },
          commandPalette: { gridMaxRows: 12, historySize: 20, historyDedup: true },
          edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
          update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
        },
        warning: null,
      },
    });
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
    const settings = {
      general: { quitShortcutEnabled: true, editorCommand: '' },
      commandPalette: { gridMaxRows: 10, historySize: 20, historyDedup: true },
      edts: { hiddenActionHints: ['other-services'], hiddenActionTypes: ['create'], branchDropdownMaxRows: 5 },
      update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
    };

    const result = await saveSettings(file, settings);

    expect(result).toEqual({ ok: true, data: undefined });
    expect(parse(await readFile(file, 'utf8'))).toEqual(settings);
  });

  it('overwrites a previously-saved file with the new value (no separate save step)', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    await saveSettings(file, DEFAULT_SETTINGS);

    await saveSettings(file, {
      general: { quitShortcutEnabled: true, editorCommand: '' },
      commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
      edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
      update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
    });

    expect(parse(await readFile(file, 'utf8'))).toEqual({
      general: { quitShortcutEnabled: true, editorCommand: '' },
      commandPalette: { gridMaxRows: 20, historySize: 20, historyDedup: true },
      edts: { hiddenActionHints: [], hiddenActionTypes: [], branchDropdownMaxRows: 5 },
      update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
    });
  });
});

describe('createSettingsPort', () => {
  it('round-trips a save then a load through the same file', async () => {
    const root = await tempRoot();
    const file = join(root, 'settings.yaml');
    const port = createSettingsPort(file);
    const settings = {
      general: { quitShortcutEnabled: false, editorCommand: '' },
      commandPalette: { gridMaxRows: 5, historySize: 20, historyDedup: true },
      edts: { hiddenActionHints: ['edts'], hiddenActionTypes: ['switch'], branchDropdownMaxRows: 5 },
      update: { concurrency: 3 }, logs: { bufferSize: 500, startWithHistory: false, filterHistorySize: 20, filterHistoryGridMaxRows: 8, filterHistoryDedup: true, restartMode: 'simple' as const },
    };

    await port.save(settings);
    const result = await port.load();

    expect(result).toEqual({ ok: true, data: { settings, warning: null } });
  });
});
