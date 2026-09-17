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

export type Command = {
  name: string;
  run: (useStore: AppStore, fullQuery: string) => void;
};

export const COMMANDS: readonly Command[] = [
  {
    name: 'registry',
    run: (useStore) => useStore.getState().openRegistryScreen(),
  },
  {
    name: 'edt-create',
    run: (useStore) => useStore.getState().openEdtCreateDialog(),
  },
  {
    name: 'edt-switch',
    run: (useStore, fullQuery) => useStore.getState().openEdtSwitchDialog(fullQuery),
  },
  {
    name: 'edt-modify',
    run: (useStore, fullQuery) => useStore.getState().openEdtModifyDialog(fullQuery),
  },
  {
    name: 'edt-delete',
    run: (useStore, fullQuery) => useStore.getState().openEdtDeleteDialog(fullQuery),
  },
  // Story 2.19: the settings screen is reachable exclusively through this registered
  // command (mirrors `registry`'s own precedent) — never bound to a raw keypress.
  {
    name: 'settings',
    run: (useStore) => useStore.getState().openSettingsScreen(),
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
