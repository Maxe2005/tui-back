// tui/commands/commands: story 2.14 — a small, static, in-memory command registry (name →
// handler) that the `:` command-entry bar (shared/command-bar.tsx) dispatches against.
// Boundaries & Constraints: "static, in-memory list in adapters/driving/tui ... no core/port
// change, no new port/adapter" (mirrors Story 2.11's own rule). The one registered command,
// `registry`, reaches the store through the same call Dashboard's own empty-registry prompt
// already makes — `useStore.getState().openRegistryScreen()` — never a direct `core/ports`
// import. `run` takes the store as a parameter (rather than closing over the module-level
// `useAppStore` singleton) so it dispatches against whichever store instance the bar was
// mounted with — the same dependency-injection convention every other tui/shared component
// in this codebase already follows (see RepoRegistryScreen's `useStore` prop).
// Story 2.15: adds `edt-create`, `edt-switch`, `edt-modify` commands that open the same
// dialogs Story 2.9 already implements (coexisting with Enter-key shortcuts).
import type { AppStore } from '../store/app-store.js';
import type { ZoneId } from '../zones/zones.js';

export type Command = {
  name: string;
  run: (useStore: AppStore, fullQuery: string) => void;
  // The zone this command operates on, if any — runCommand below switches the active zone to
  // this one before running the command, so e.g. `:edt-switch` typed from the Dashboard zone
  // still lands its dialog on the EDTs zone rather than opening it invisibly behind whichever
  // zone happened to be active. Commands with no natural zone (registry/settings/quit, all
  // full-screen overlays or zone-independent) leave this unset.
  zoneId?: ZoneId;
};

export const COMMANDS: readonly Command[] = [
  {
    name: 'registry',
    run: (useStore) => useStore.getState().openRegistryScreen(),
  },
  {
    name: 'edt-create',
    run: (useStore) => useStore.getState().openEdtCreateDialog(),
    zoneId: 'edts',
  },
  {
    name: 'edt-switch',
    run: (useStore, fullQuery) => useStore.getState().openEdtSwitchDialog(fullQuery),
    zoneId: 'edts',
  },
  {
    name: 'edt-modify',
    run: (useStore, fullQuery) => useStore.getState().openEdtModifyDialog(fullQuery),
    zoneId: 'edts',
  },
  {
    name: 'edt-delete',
    run: (useStore, fullQuery) => useStore.getState().openEdtDeleteDialog(fullQuery),
    zoneId: 'edts',
  },
  // Story 2.19: the settings screen is reachable exclusively through this registered
  // command (mirrors `registry`'s own precedent) — never bound to a raw keypress.
  {
    name: 'settings',
    run: (useStore) => useStore.getState().openSettingsScreen(),
  },
  // `:reset` — the selective tool-data reset overlay, reachable only through this command
  // (never a raw keybinding). Guarded like `quit`: openResetScreen itself refuses (and
  // surfaces why) while a group update or an EDT action is in progress.
  {
    name: 'reset',
    run: (useStore) => {
      useStore.getState().openResetScreen();
    },
  },
  // Mirrors shouldQuit's own runInProgress guard (app-shell.tsx) so `:quit` can't bypass it —
  // unlike the raw `q` keypress, this command stays reachable regardless of
  // settings.general.quitShortcutEnabled (that flag only gates the keypress). Goes through
  // requestQuit(), the same store flag AppShell's quitRequested effect already watches to call
  // the composition root's onQuit — never a direct process.exit here.
  {
    name: 'quit',
    run: (useStore) => {
      if (!useStore.getState().runInProgress) {
        useStore.getState().requestQuit();
      }
    },
  },
  // Story 3.11: the three update commands — each opens the story 3.7 config screen
  // pre-scoped to its own targets, never starting an unconfigured run. The bar's
  // runCommand() activates the Update zone first (zoneId above); the run itself only
  // dispatches through the store (this file's DI convention).
  {
    name: 'update-edt',
    zoneId: 'update',
    run: (useStore) => {
      void useStore.getState().openUpdateConfig('edt');
    },
  },
  {
    name: 'update-all',
    zoneId: 'update',
    run: (useStore) => {
      void useStore.getState().openUpdateConfig('all');
    },
  },
  {
    name: 'update-service',
    zoneId: 'update',
    run: (useStore, fullQuery) => {
      void useStore.getState().openUpdateServiceDialog(fullQuery);
    },
  },
];

// Pure prefix filter, case-insensitive — mirrors zones.ts's pure-function convention
// (nextZoneId) so the command bar's filtering/autocomplete logic stays directly
// unit-testable without mounting Ink. Empty query matches every command
// (`''.startsWith('')` — every name starts with the empty string).
export function matchCommands(
  query: string,
  commands: readonly Command[] = COMMANDS,
): Command[] {
  const needle = query.toLowerCase();
  return commands.filter((command) => command.name.toLowerCase().startsWith(needle));
}

// Exact, case-insensitive name match — the only thing Enter is ever allowed to run
// (Boundaries: "never execute a command on a non-exact, ambiguous, or partial Enter match").
export function findExactCommand(
  query: string,
  commands: readonly Command[] = COMMANDS,
): Command | null {
  const needle = query.toLowerCase();
  return commands.find((command) => command.name.toLowerCase() === needle) ?? null;
}

// The single entry point the command bar's Enter-to-run should call (rather than
// `command.run` directly): switches to the command's own zone first, if it has one and it
// isn't already active, so a command typed from another tab (e.g. `:edt-switch` from
// Dashboard) still lands its effect on that zone instead of running invisibly behind whichever
// zone the user happened to be on. A no-op zone-switch (already on that zone, or the command
// has none) leaves `setActiveZone` uncalled.
export function runCommand(command: Command, useStore: AppStore, fullQuery: string): void {
  if (command.zoneId && useStore.getState().activeZone !== command.zoneId) {
    useStore.getState().setActiveZone(command.zoneId);
  }
  command.run(useStore, fullQuery);
}
