// cli/commands/shared: helpers used by several command families (settings loading with stderr reporting).
import { DEFAULT_SETTINGS, type Settings, type SettingsPort } from '../../../../core/ports/settings.js';

// Loads settings.yaml for a command; a load failure or a corrupt-file warning goes to stderr
// (separate from the stdout JSON envelope) and the built-in defaults apply.
export async function loadSettingsOrDefaults(port: SettingsPort): Promise<Settings> {
  const loaded = await port.load();
  if (!loaded.ok) {
    console.error(`tui-back: could not read settings, using defaults: ${loaded.error.message}`);
  } else if (loaded.data.warning !== null) {
    console.error(`tui-back: ${loaded.data.warning}`);
  }
  return loaded.ok ? loaded.data.settings : DEFAULT_SETTINGS;
}
