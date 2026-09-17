// tui/store/slices: the `:settings` screen's live, applied settings — persisted to
// settings.yaml, optimistic-applied to the live store immediately (Boundaries: "no separate
// save step"). Extracted from app-store.ts (see that file's header for why) — a StateCreator
// factory combined with the other slices into one Zustand store (AD-10: still exactly one
// store/one hook).
import type { StateCreator } from 'zustand';
import { DEFAULT_SETTINGS, type Settings } from '../../../../../core/ports/settings.js';
import type { AppState, AppStoreDeps } from '../app-store.js';

// Story 2.19: a partial update accepted by updateSettings — each present top-level key
// shallow-merges into that whole sub-object's existing fields, e.g.
// `{ commandPalette: { gridMaxRows: 10 } }` or `{ edts: { hiddenActionHints: [...] } }` (the
// latter leaves `edts.hiddenActionTypes` untouched, and vice versa) — see updateSettings'
// `{ ...current.edts, ...partial.edts }` spread below. Deliberately `Partial` one level deeper
// than a plain `Partial<Settings>` would give (each sub-object's own fields are individually
// optional too) — that's the whole point: a caller only ever supplies the one field it's
// changing, never the sub-object's other, untouched field. Never a deep-merge below this one
// level, though — the two sub-objects each stay flat.
export type SettingsUpdate = {
  commandPalette?: Partial<Settings['commandPalette']>;
  edts?: Partial<Settings['edts']>;
  // Story 5.1: same shallow-merge convention as the two fields above.
  logs?: Partial<Settings['logs']>;
};

export type SettingsSlice = {
  // Story 2.19: the `:settings` screen — reachable exclusively via the `settings` command
  // inside the `:` command bar (mirrors registryScreenOpen's triplet exactly; never a raw
  // keypress). `settings` is the live, applied value every consumer (command-bar.tsx,
  // edts-zone.tsx) reads — seeded with DEFAULT_SETTINGS until loadSettings() resolves, so an
  // unwired store (every pre-2.19 `createAppStore()` test call) stays usable. `settingsWarning`
  // carries a corrupt/invalid settings.yaml's non-blocking field-naming message, cleared once
  // the screen closes.
  settings: Settings;
  settingsWarning: string | null;
  settingsScreenOpen: boolean;
  loadSettings: () => Promise<void>;
  updateSettings: (partial: SettingsUpdate) => Promise<void>;
  openSettingsScreen: () => void;
  closeSettingsScreen: () => void;
};

export function createSettingsSlice(deps?: AppStoreDeps): StateCreator<AppState, [], [], SettingsSlice> {
  // Story 2.19 patch: settingsSaveChain serializes updateSettings' persistence calls so
  // concurrent updates hit disk in the order they were requested (each save chains onto the
  // previous one) rather than racing; settingsVersion is a monotonic counter bumped on every
  // updateSettings call so a slower, in-flight loadSettings can detect a newer update has
  // landed since it started and skip clobbering it.
  let settingsSaveChain: Promise<void> = Promise.resolve();
  let settingsVersion = 0;

  return (set, get) => ({
    settings: DEFAULT_SETTINGS,
    settingsWarning: null,
    settingsScreenOpen: false,
    loadSettings: async () => {
      if (!deps) {
        return;
      }
      // Capture the version before awaiting: if an updateSettings call lands while this load
      // is still in flight, settingsVersion will have moved on and this stale result must not
      // clobber the newer value with whatever was read from disk before that update happened.
      const startVersion = settingsVersion;
      const result = await deps.settings.load();
      if (settingsVersion !== startVersion) {
        return;
      }
      if (result.ok) {
        set({ settings: result.data.settings, settingsWarning: result.data.warning });
      } else {
        // A genuine I/O error (not the corrupt/invalid-file path, which is always `ok`):
        // keep whatever settings were last in effect rather than silently resetting to
        // defaults, and surface the failure the same way a corrupt file's warning would.
        set({ settingsWarning: result.error.message });
      }
    },
    updateSettings: async (partial) => {
      settingsVersion += 1;
      const current = get().settings;
      const next: Settings = {
        commandPalette: { ...current.commandPalette, ...partial.commandPalette },
        edts: { ...current.edts, ...partial.edts },
        logs: { ...current.logs, ...partial.logs },
      };
      // Optimistic: applies to the live store immediately, before persistence even starts
      // (Boundaries: "every change applies to the live store and persists to disk
      // immediately, no separate save step").
      set({ settings: next });
      if (!deps) {
        return;
      }
      // Chain onto the pending save so concurrent updateSettings calls persist to disk in the
      // order they were requested, instead of racing (a slower earlier save landing after a
      // faster later one would leave stale data on disk).
      const run = async () => {
        const result = await deps.settings.save(next);
        if (!result.ok) {
          set({ settingsWarning: result.error.message });
        } else {
          set({ settingsWarning: null });
        }
      };
      const chained = settingsSaveChain.then(run, run);
      settingsSaveChain = chained;
      await chained;
    },
    // No reload-on-open here (unlike openRegistryScreen's resetRegistryScreen): `settings` is
    // loaded once at app mount (AppShell's mount effect, mirroring loadEdts/loadTabVisibility)
    // and kept live thereafter by updateSettings' own optimistic set — command-bar.tsx and
    // edts-zone.tsx read it whether or not this screen has ever been opened.
    openSettingsScreen: () => set({ settingsScreenOpen: true }),
    // Clears settingsWarning too: closing acknowledges the warning, so reopening the screen
    // (or a later screen action) doesn't keep showing a stale message the developer already saw.
    closeSettingsScreen: () => set({ settingsScreenOpen: false, settingsWarning: null }),
  });
}
