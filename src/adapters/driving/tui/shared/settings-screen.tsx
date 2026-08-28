// tui/shared/settings-screen: story 2.19's `:settings` overlay — a tab-organized
// `modal-dialog` instance (General / EDTs / Command Palette), reachable exclusively through
// the registered `settings` command inside the `:` command bar (mirrors
// repo-registry-screen.tsx's own precedent, never a raw keypress). Every change applies to
// the live store and persists to settings.yaml immediately via the store's `updateSettings`
// action — there is no separate save step and no local "dirty" state here.
//
// Testability convention (render-to-string.ts): the shared renderToString harness's fake
// stdin never emits data, so a useInput callback itself is never invoked by any test in this
// repo — every key-handling decision below is a pure, directly-testable function; useInput
// only interprets the raw Ink Key and dispatches the pure result (mirrors
// repo-registry-screen.tsx's typeRootInputChar/moveCandidateCursor and command-bar.tsx's
// resolveTabPress).
//
// EDTs-tab token list (Design Notes): the three hideable hint tokens below are exactly the
// `PaneFocus` contexts edts-zone.tsx's `formatAvailableActionsHint` (story 2.18, its
// formerly-`formatEdtActionHistory`-embedded hint line) emits one hint string for — 'edts',
// 'edt-services', 'other-services' — never invented placeholder ids.
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { CheckboxListItem } from './components/checkbox-list-item.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { ModalDialog } from './components/modal-dialog.js';
import { colors, spacing, typography } from './theme/theme.js';
import { useAppStore, type AppStore } from '../store/app-store.js';
import {
  MAX_GRID_MAX_ROWS,
  MIN_GRID_MAX_ROWS,
} from '../../../../core/ports/settings.js';

export type SettingsTab = 'general' | 'edts' | 'command-palette';

export const SETTINGS_TABS: readonly SettingsTab[] = ['general', 'edts', 'command-palette'];

export const SETTINGS_TAB_LABELS: Record<SettingsTab, string> = {
  general: 'General',
  edts: 'EDTs',
  'command-palette': 'Command Palette',
};

// AC1: Left/Right/Tab all cycle in the same General -> EDTs -> Command Palette -> General
// order (SETTINGS_TABS' own declared order) — Left and Tab both step forward here, deliberately
// simpler than zones.ts's bidirectional nextZoneId since there's no wrap-skip/omitted-tab
// concern (every settings tab is always reachable).
export function nextSettingsTab(current: SettingsTab, direction: 1 | -1): SettingsTab {
  const index = SETTINGS_TABS.indexOf(current);
  const nextIndex = (index + direction + SETTINGS_TABS.length) % SETTINGS_TABS.length;
  return SETTINGS_TABS[nextIndex]!;
}

export type SettingsTabState = {
  active: boolean;
  labelColor: string;
  backgroundColor: string;
  bold: boolean;
};

// Mirrors zone-tab-bar.tsx's resolveZoneTabState active/inactive treatment at a smaller
// scale (Boundaries: "visually mirroring zone-tab-bar.tsx's active/inactive treatment") — no
// strikethrough/badge here, since settings tabs are never manifest-gated or event-badged.
export function resolveSettingsTabState(tab: SettingsTab, activeTab: SettingsTab): SettingsTabState {
  const active = tab === activeTab;
  return {
    active,
    labelColor: active ? colors.background : colors['text-dim'],
    backgroundColor: active ? colors.accent : colors.background,
    bold: active ? typography['active-tab'].bold : typography.label.bold,
  };
}

// Command Palette tab: Story 2.17's COMMAND_GRID_MAX_ROWS default (8), now user-overridable.
// Clamped to a sane, always-positive range — 0/negative would break groupCommandsByColumn's
// own `Math.max(1, maxRows)` floor, and the zod schema enforces the same [MIN, MAX] bound
// (core/ports/settings.ts is the single source of truth for both, so they can't drift apart).
// Re-exported here so existing imports of these two constants from this module keep working.
export { MIN_GRID_MAX_ROWS, MAX_GRID_MAX_ROWS };

export function clampGridMaxRows(value: number): number {
  return Math.min(Math.max(value, MIN_GRID_MAX_ROWS), MAX_GRID_MAX_ROWS);
}

export function adjustGridMaxRows(current: number, direction: 'up' | 'down'): number {
  return clampGridMaxRows(current + (direction === 'up' ? 1 : -1));
}

// A typed digit sets the value directly (I/O matrix: "Up/Down or typed digit"). Only a single
// digit 1-9 is meaningful — '0' is never a valid gridMaxRows (zod's `.positive()`), and any
// non-digit character is ignored rather than appended (this is a value-set field, not free text).
export function parseGridMaxRowsDigit(input: string): number | null {
  if (!/^[1-9]$/.test(input)) {
    return null;
  }
  return clampGridMaxRows(Number(input));
}

// EDTs tab: the hideable per-context action hints (story 2.18's formatAvailableActionsHint).
export type HideableActionHint = { id: string; label: string };

export const HIDEABLE_ACTION_HINTS: readonly HideableActionHint[] = [
  { id: 'edts', label: 'EDT selector — "[Enter] Switch" / "[Enter] Modify"' },
  { id: 'edt-services', label: 'EDT services — "[Enter] Remove / Change branch"' },
  { id: 'other-services', label: 'Other services — "[Enter] Add to EDT"' },
];

export function moveHintCursor(current: number, direction: 'up' | 'down', length: number): number {
  if (length === 0) {
    return 0;
  }
  const next = direction === 'down' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

// Toggles `id` in `hidden`, never mutating the input array (mirrors
// repo-registry-screen.tsx's toggleCandidateSelection immutability convention, array-shaped
// since Settings.edts.hiddenActionHints is a string[], not a Set).
export function toggleHiddenHint(hidden: readonly string[], id: string): string[] {
  return hidden.includes(id) ? hidden.filter((existing) => existing !== id) : [...hidden, id];
}

// No `onClose`/Esc handling here (unlike command-bar.tsx's self-contained Esc): AppShell owns
// Esc-close for this screen the same way it does for registryScreenOpen — wired centrally in
// app-shell.tsx's own useInput, gated on `settingsScreenOpen`, rather than duplicated locally.
export type SettingsScreenProps = {
  useStore?: AppStore;
  // Test-only injection point (mirrors edts-zone.tsx's `initialPaneFocus`): renderToString
  // performs one synchronous render-then-unmount pass and never observes a keypress (the
  // shared harness's fake stdin never emits data), so a smoke test can't Tab its way to the
  // EDTs/Command Palette tab bodies otherwise. Production always starts on General (AC1).
  initialTab?: SettingsTab;
};

export function SettingsScreen({ useStore = useAppStore, initialTab = 'general' }: SettingsScreenProps) {
  const settings = useStore((state) => state.settings);
  const settingsWarning = useStore((state) => state.settingsWarning);
  const updateSettings = useStore((state) => state.updateSettings);

  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const [hintCursor, setHintCursor] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      // Esc is handled by AppShell (closeSettingsScreen) — swallow it here only so it never
      // falls through to the tab-cycle/value-adjust branches below.
      return;
    }

    // AC1/AC4: Left/Right/Tab cycle tabs, always available, keyboard-only.
    if (key.tab || key.leftArrow || key.rightArrow) {
      const direction = key.leftArrow ? -1 : 1;
      setTab((current) => nextSettingsTab(current, direction));
      return;
    }

    if (tab === 'command-palette') {
      if (key.upArrow) {
        void updateSettings({
          commandPalette: { gridMaxRows: adjustGridMaxRows(settings.commandPalette.gridMaxRows, 'up') },
        });
        return;
      }
      if (key.downArrow) {
        void updateSettings({
          commandPalette: { gridMaxRows: adjustGridMaxRows(settings.commandPalette.gridMaxRows, 'down') },
        });
        return;
      }
      const digit = parseGridMaxRowsDigit(input);
      if (digit !== null) {
        void updateSettings({ commandPalette: { gridMaxRows: digit } });
        return;
      }
      return;
    }

    if (tab === 'edts') {
      if (key.upArrow) {
        setHintCursor((current) => moveHintCursor(current, 'up', HIDEABLE_ACTION_HINTS.length));
        return;
      }
      if (key.downArrow) {
        setHintCursor((current) => moveHintCursor(current, 'down', HIDEABLE_ACTION_HINTS.length));
        return;
      }
      if (input === ' ') {
        const token = HIDEABLE_ACTION_HINTS[hintCursor];
        if (token) {
          void updateSettings({
            edts: { hiddenActionHints: toggleHiddenHint(settings.edts.hiddenActionHints, token.id) },
          });
        }
      }
    }
  });

  return (
    <ModalDialog title="SETTINGS" open onConfirm={() => {}} onCancel={() => {}}>
      <Box flexDirection="column">
        <Box flexDirection="row">
          {SETTINGS_TABS.map((t) => {
            const state = resolveSettingsTabState(t, tab);
            return (
              <Box key={t} paddingX={spacing['1']} backgroundColor={state.backgroundColor}>
                <Text bold={state.bold} color={state.labelColor}>
                  {SETTINGS_TAB_LABELS[t]}
                </Text>
              </Box>
            );
          })}
        </Box>

        {settingsWarning ? <DimAnnotation text={settingsWarning} /> : null}

        {/* AC2: General renders validly with zero settings defined — never an error. */}
        {tab === 'general' ? (
          <Text color={colors['text-dim']}>No general settings yet.</Text>
        ) : null}

        {tab === 'command-palette' ? (
          <Box flexDirection="column">
            <Text color={colors.text}>
              Command grid max rows: <Text color={colors.accent}>{settings.commandPalette.gridMaxRows}</Text>
            </Text>
            <DimAnnotation text="Up/Down to adjust, or type a digit (1-9)." />
          </Box>
        ) : null}

        {tab === 'edts' ? (
          <Box flexDirection="column">
            {HIDEABLE_ACTION_HINTS.map((token, index) => {
              const highlighted = index === hintCursor;
              return (
                // review patch (repo-registry-screen.tsx precedent): checkbox-list-item's own
                // `selected` prop has no visible effect on its own — the highlighted row needs
                // its own `›` cursor glyph, rendered as a sibling column.
                <Box key={token.id} flexDirection="row">
                  <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                  <CheckboxListItem
                    label={token.label}
                    selected={highlighted}
                    state={settings.edts.hiddenActionHints.includes(token.id) ? 'checked' : 'unchecked'}
                  />
                </Box>
              );
            })}
            <DimAnnotation text="Space to toggle — checked hides that hint from the EDT detail pane." />
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
