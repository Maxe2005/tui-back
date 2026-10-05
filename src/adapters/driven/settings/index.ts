// adapters/driven/settings: the driven implementation of core's SettingsPort — per-user
// preferences in XDG_CONFIG_HOME/tui-back/settings.yaml. Unlike registry/manifest, a missing
// file, empty file, invalid YAML or a zod failure is always `ok`, falling back to
// DEFAULT_SETTINGS (the last three with a non-blocking `warning`): a failed load must never
// block the settings screen. Only a genuine I/O error is an `err`.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { err, ok, type Result } from '../../../core/result.js';
import { DEFAULT_SETTINGS, type Settings, type SettingsLoadResult, type SettingsPort } from '../../../core/ports/settings.js';
import type { XdgPaths } from '../xdg/index.js';
import { ensureXdgDir } from '../xdg/index.js';
import { settingsSchema } from './schema.js';

export function resolveSettingsFile(xdg: XdgPaths): string {
  return join(xdg.configDir, 'settings.yaml');
}

export function createSettingsPort(settingsFile: string): SettingsPort {
  return {
    load: () => loadSettings(settingsFile),
    save: (settings) => saveSettings(settingsFile, settings),
  };
}

export async function loadSettings(settingsFile: string): Promise<Result<SettingsLoadResult>> {
  let content: string;
  try {
    content = await readFile(settingsFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      // Missing file (first run): defaults used silently, no warning.
      return ok({ settings: DEFAULT_SETTINGS, warning: null });
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err('settings-read-error', `Failed to read settings file ${settingsFile}: ${detail}`);
  }

  const trimmed = content.trim();
  if (trimmed === '') {
    return ok({ settings: DEFAULT_SETTINGS, warning: null });
  }

  let parsed: unknown;
  try {
    parsed = parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return ok({
      settings: DEFAULT_SETTINGS,
      warning: `Invalid YAML in ${settingsFile}: ${detail} — using defaults.`,
    });
  }

  const result = settingsSchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first ? (first.path.length > 0 ? first.path.join('.') : '(root)') : '<unknown>';
    const reason = first ? first.message : 'unknown validation error';
    return ok({
      settings: DEFAULT_SETTINGS,
      warning: `Invalid settings file ${settingsFile}: ${field} — ${reason} — using defaults.`,
    });
  }

  return ok({ settings: result.data, warning: null });
}

export async function saveSettings(settingsFile: string, settings: Settings): Promise<Result<void>> {
  try {
    ensureXdgDir(dirname(settingsFile));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('settings-write-error', `Failed to create settings directory ${dirname(settingsFile)}: ${detail}`);
  }
  try {
    await writeFile(settingsFile, stringify(settings), 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err('settings-write-error', `Failed to write settings file ${settingsFile}: ${detail}`);
  }
  return ok(undefined);
}
