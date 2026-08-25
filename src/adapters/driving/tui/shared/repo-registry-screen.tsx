// tui/shared/repo-registry-screen: story 2.11 — a TUI overlay front-end over Story 1.5's
// existing scan/register use-cases (AD-6). Not a 7th ZoneId/tab (zones/zones.ts's closed
// union stays unchanged) — an overlay in the same family as the command/filter/help
// ModalDialog overlays, opened/closed via app-store's registryScreenOpen flag so both the
// `registry` command inside Story 2.14's `:` command bar and Dashboard's empty-registry
// prompt can trigger it (`:` itself never opens this screen directly, story 2.14).
//
// Testability convention (render-to-string.tsx): the shared renderToString harness's fake
// stdin never emits data, so a useInput callback itself is never invoked by any test in this
// repo — every key-handling decision below is a pure, directly-testable function; useInput
// only interprets the raw Ink Key and dispatches the pure result (mirrors edts-zone.tsx's
// resolveSelectionDirection/moveSelection and keybinding-help.tsx's resolveHelpScroll).
import { useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { CheckboxListItem } from './components/checkbox-list-item.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { ModalDialog } from './components/modal-dialog.js';
import { Spinner } from './components/spinner.js';
import { colors } from './theme/theme.js';
import {
  useAppStore,
  type AppStore,
  type RegistryOutcome,
  type RegistryRegisterResult,
} from '../store/app-store.js';
import type { ScanResult } from '../../../../core/ports/registry.js';

// Static manifest-creation guidance (Boundaries & Constraints: "always shown alongside
// scan/register controls — never gated to first launch only"). Field names mirror Story
// 1.4's zod schema (adapters/driven/manifest/schema.ts): service, container, modules,
// optional migrationCommand (absent = no migrations to run), optional sharedBranch
// (default development).
export const MANIFEST_GUIDANCE_LINES: readonly string[] = [
  'A repo is managed once it has a root .tui-back.yaml declaring service, container,',
  'and modules (migrationCommand is optional — omit it if the service has no migrations;',
  'sharedBranch is optional too, defaults to "development").',
  'Create one by hand, or run the /manifest-generator skill inside the target repo.',
];

export type RegistryScreenPhase =
  | 'root-input'
  | 'scanning'
  | 'scan-error'
  | 'empty'
  | 'candidates'
  | 'registering'
  | 'results';

// Pure phase derivation from the store's registry-screen fields — the I/O matrix's states
// (scanning, distinct empty-vs-error, candidates, registering, results) read off store data
// alone, never off transient local component state.
export function resolveRegistryScreenPhase(store: {
  registryScanStatus: 'idle' | 'loading' | 'error';
  registryScanResult: ScanResult | null;
  registryRegisterStatus: 'idle' | 'loading';
  registryRegisterResults: RegistryRegisterResult[] | null;
}): RegistryScreenPhase {
  if (store.registryRegisterResults !== null) {
    return 'results';
  }
  if (store.registryRegisterStatus === 'loading') {
    return 'registering';
  }
  if (store.registryScanStatus === 'loading') {
    return 'scanning';
  }
  if (store.registryScanStatus === 'error') {
    return 'scan-error';
  }
  if (store.registryScanResult !== null) {
    // Distinct "nothing found" state — never rendered the same as a scan failure.
    return store.registryScanResult.candidates.length === 0 ? 'empty' : 'candidates';
  }
  return 'root-input';
}

// Root-path free-text entry. Ctrl/meta combos (e.g. Ctrl+W resize-mode, reserved elsewhere
// in the app) and empty-input control keys (arrows, Enter, Esc — all handled separately by
// their own key flags) are never appended as literal characters.
export function typeRootInputChar(current: string, input: string, key: Pick<Key, 'ctrl' | 'meta'>): string {
  if (input.length === 0 || key.ctrl || key.meta) {
    return current;
  }
  return current + input;
}

export function backspaceRootInput(current: string): string {
  return current.slice(0, -1);
}

// Candidate-list cursor movement (Story 1.9's checkbox-list-item is a static row; the
// screen owns which row is currently highlighted for Space/navigation).
export type CandidateDirection = 'up' | 'down';

export function moveCandidateCursor(current: number, direction: CandidateDirection, length: number): number {
  if (length === 0) {
    return 0;
  }
  const next = direction === 'down' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

// Space toggles the highlighted candidate's checked state — checkbox-list-item's existing
// semantics (keybindings.ts:26-33): Space toggles, Enter confirms the whole selection.
export function toggleCandidateSelection(selected: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(selected);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

function outcomeColor(outcome: RegistryOutcome): string {
  switch (outcome) {
    case 'registered':
      return colors.success;
    case 'already-registered':
      return colors.info;
    case 'failed':
    default:
      return colors.error;
  }
}

export function RepoRegistryScreen({ useStore = useAppStore }: { useStore?: AppStore }) {
  const registryScanStatus = useStore((state) => state.registryScanStatus);
  const registryScanError = useStore((state) => state.registryScanError);
  const registryScanResult = useStore((state) => state.registryScanResult);
  const registryRegisterStatus = useStore((state) => state.registryRegisterStatus);
  const registryRegisterResults = useStore((state) => state.registryRegisterResults);
  const scanRegistryRoot = useStore((state) => state.scanRegistryRoot);
  const registerRegistryCandidates = useStore((state) => state.registerRegistryCandidates);

  // No mount-effect reset here: app-store's openRegistryScreen() clears scan/register state
  // atomically with becoming open (before this component ever mounts), so a reopened screen
  // never shows a stale prior session and no post-mount effect races a seeded render.
  const phase = resolveRegistryScreenPhase({
    registryScanStatus,
    registryScanResult,
    registryRegisterStatus,
    registryRegisterResults,
  });

  const [root, setRoot] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const candidates = registryScanResult?.candidates ?? [];
  const clampedCursor = candidates.length === 0 ? 0 : Math.min(cursor, candidates.length - 1);

  useInput((input, key) => {
    if (phase === 'root-input') {
      if (key.return) {
        const trimmed = root.trim();
        if (trimmed.length > 0) {
          void scanRegistryRoot(trimmed);
        }
        return;
      }
      if (key.backspace || key.delete) {
        setRoot((current) => backspaceRootInput(current));
        return;
      }
      setRoot((current) => typeRootInputChar(current, input, key));
      return;
    }

    if (phase === 'candidates') {
      if (key.downArrow) {
        setCursor((current) => moveCandidateCursor(current, 'down', candidates.length));
        return;
      }
      if (key.upArrow) {
        setCursor((current) => moveCandidateCursor(current, 'up', candidates.length));
        return;
      }
      if (input === ' ') {
        const path = candidates[clampedCursor];
        if (path !== undefined) {
          setSelected((current) => toggleCandidateSelection(current, path));
        }
        return;
      }
      if (key.return) {
        if (selected.size > 0) {
          void registerRegistryCandidates([...selected]);
        }
        return;
      }
    }
  });

  return (
    <ModalDialog title="REPO REGISTRY" open onConfirm={() => {}} onCancel={() => {}}>
      <Box flexDirection="column">
        <Box flexDirection="column">
          {MANIFEST_GUIDANCE_LINES.map((line) => (
            <DimAnnotation key={line} text={line} />
          ))}
        </Box>

        {phase === 'root-input' ? (
          <Box flexDirection="column">
            <Text color={colors.text}>
              Root path: <Text color={colors.accent}>{root}</Text>
              <Text color={colors['text-dim']}>█</Text>
            </Text>
            <DimAnnotation text="Type a path, then Enter to scan." />
          </Box>
        ) : null}

        {phase === 'scanning' ? (
          <Box>
            <Spinner />
            <Text color={colors.text}> Scanning {root}…</Text>
          </Box>
        ) : null}

        {phase === 'scan-error' ? (
          <Box flexDirection="column">
            <Text color={colors.error}>Scan failed.</Text>
            {registryScanError ? <DimAnnotation text={registryScanError} /> : null}
          </Box>
        ) : null}

        {phase === 'empty' ? (
          <Text color={colors['text-dim']}>No manifest-carrying repos found here.</Text>
        ) : null}

        {phase === 'candidates' ? (
          <Box flexDirection="column">
            <Text color={colors['text-dim']}>CANDIDATES</Text>
            {candidates.map((path, index) => {
              const highlighted = index === clampedCursor;
              return (
                // review patch: checkbox-list-item.tsx's own `selected` prop is accepted but
                // never read by its layout function, so it has no visible effect on its own —
                // the highlighted (arrow-navigable) row must still be visually distinguishable
                // without modifying that shared component (spec boundary: reuse as-is). A
                // `›` cursor glyph, matching list-row.tsx's own selection-marker convention,
                // is rendered here as a sibling column instead.
                <Box key={path} flexDirection="row">
                  <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                  <CheckboxListItem
                    label={path}
                    selected={highlighted}
                    state={selected.has(path) ? 'checked' : 'unchecked'}
                  />
                </Box>
              );
            })}
            <DimAnnotation text="Space to toggle, Enter to register the selection." />
          </Box>
        ) : null}

        {phase === 'registering' ? (
          <Box>
            <Spinner />
            <Text color={colors.text}> Registering…</Text>
          </Box>
        ) : null}

        {phase === 'results' ? (
          <Box flexDirection="column">
            <Text color={colors['text-dim']}>RESULTS</Text>
            {(registryRegisterResults ?? []).map((result) => (
              <Box key={result.path} flexDirection="column">
                <Text color={colors.text}>
                  {result.path} — <Text color={outcomeColor(result.outcome)}>{result.outcome}</Text>
                </Text>
                {result.detail ? <DimAnnotation text={result.detail} /> : null}
              </Box>
            ))}
            <DimAnnotation text="Esc to close." />
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
