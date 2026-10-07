// tui/shared/repo-registry-screen: an overlay (not a zone tab) over the scan/register
// use-cases, opened via the store's registryScreenOpen flag by the `registry` command or
// Dashboard's empty-registry prompt. Ctrl+L opens "Clean stale entries": classify
// unreachable/manifest-not-found entries and remove the confirmed ones. Every key decision is a
// pure function because renderToString's fake stdin never emits keys.
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
  type StaleRegistryEntry,
  type RemoveStaleRegistryEntryResult,
  type RemoveStaleRegistryOutcome,
} from '../store/app-store.js';
import type { ScanResult } from '../../../../core/ports/registry.js';

// Static manifest-creation guidance, always shown alongside the scan/register controls — never
// gated to first launch only. Field names mirror the manifest zod schema
// (adapters/driven/manifest/schema.ts): service, container, modules, optional migrationCommand
// (absent = no migrations to run), optional sharedBranch (default development), optional
// protectedBranches.
export const MANIFEST_GUIDANCE_LINES: readonly string[] = [
  'A repo is managed once it has a root .tui-back.yaml declaring service, container,',
  'and modules (migrationCommand is optional — omit it if the service has no migrations;',
  'sharedBranch is optional too, defaults to "development").',
  'protectedBranches (optional list) names the branches no EDT may claim, besides sharedBranch;',
  'omit it and only sharedBranch is protected.',
  'Create one by hand, or run the /manifest-generator skill inside the target repo.',
];

export type RegistryScreenPhase =
  | 'root-input'
  | 'scanning'
  | 'scan-error'
  | 'empty'
  | 'candidates'
  | 'registering'
  | 'results'
  // The "Clean stale entries" action's phases — three, not the scan flow's five:
  // classifyStaleRegistry is a quick registry/manifest read, not a filesystem walk, so
  // loading/error/empty all fold into 'clean-candidates' and are told apart inside its render
  // block.
  | 'clean-candidates'
  | 'cleaning'
  | 'clean-results';

// Pure phase derivation from the store's registry-screen fields — scanning, distinct
// empty-vs-error, candidates, registering, results, and the clean-candidates/cleaning/
// clean-results phases read off store data alone, never off transient component state.
export function resolveRegistryScreenPhase(store: {
  registryScanStatus: 'idle' | 'loading' | 'error';
  registryScanResult: ScanResult | null;
  registryRegisterStatus: 'idle' | 'loading';
  registryRegisterResults: RegistryRegisterResult[] | null;
  registryCleanScanStatus: 'idle' | 'loading' | 'error';
  registryCleanCandidates: StaleRegistryEntry[] | null;
  registryCleanStatus: 'idle' | 'loading';
  registryCleanResults: RemoveStaleRegistryEntryResult[] | null;
}): RegistryScreenPhase {
  if (store.registryCleanResults !== null) {
    return 'clean-results';
  }
  if (store.registryCleanStatus === 'loading') {
    return 'cleaning';
  }
  if (store.registryRegisterResults !== null) {
    return 'results';
  }
  if (store.registryRegisterStatus === 'loading') {
    return 'registering';
  }
  if (
    store.registryCleanScanStatus === 'loading' ||
    store.registryCleanScanStatus === 'error' ||
    store.registryCleanCandidates !== null
  ) {
    return 'clean-candidates';
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

// Candidate-list cursor movement (checkbox-list-item is a static row; the screen owns which row
// is highlighted for Space/navigation).
export type CandidateDirection = 'up' | 'down';

export function moveCandidateCursor(current: number, direction: CandidateDirection, length: number): number {
  if (length === 0) {
    return 0;
  }
  const next = direction === 'down' ? current + 1 : current - 1;
  return Math.min(Math.max(next, 0), length - 1);
}

// Space toggles the highlighted candidate's checked state — checkbox-list-item's semantics:
// Space toggles, Enter confirms the whole selection.
export function toggleCandidateSelection(selected: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(selected);
  if (next.has(path)) {
    next.delete(path);
  } else {
    next.add(path);
  }
  return next;
}

// Clean candidates render pre-checked (unlike scan/register's candidates, which start
// unchecked). Tracking the *excluded* set rather than the *selected* one gives "everything
// checked by default" for free: an empty exclusion set already means "all selected".
export function toggleCleanCandidateExclusion(excluded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(excluded);
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

function staleOutcomeColor(outcome: RemoveStaleRegistryOutcome): string {
  return outcome === 'removed' ? colors.success : colors.error;
}

export function RepoRegistryScreen({ useStore = useAppStore }: { useStore?: AppStore }) {
  const registryScanStatus = useStore((state) => state.registryScanStatus);
  const registryScanError = useStore((state) => state.registryScanError);
  const registryScanResult = useStore((state) => state.registryScanResult);
  const registryRegisterStatus = useStore((state) => state.registryRegisterStatus);
  const registryRegisterResults = useStore((state) => state.registryRegisterResults);
  const scanRegistryRoot = useStore((state) => state.scanRegistryRoot);
  const registerRegistryCandidates = useStore((state) => state.registerRegistryCandidates);
  const registryCleanScanStatus = useStore((state) => state.registryCleanScanStatus);
  const registryCleanScanError = useStore((state) => state.registryCleanScanError);
  const registryCleanCandidates = useStore((state) => state.registryCleanCandidates);
  const registryCleanErrors = useStore((state) => state.registryCleanErrors);
  const scanRegistryStaleEntries = useStore((state) => state.scanRegistryStaleEntries);
  const registryCleanStatus = useStore((state) => state.registryCleanStatus);
  const registryCleanResults = useStore((state) => state.registryCleanResults);
  const removeStaleRegistryCandidates = useStore((state) => state.removeStaleRegistryCandidates);

  // No mount-effect reset here: app-store's openRegistryScreen() clears scan/register/clean
  // state atomically with becoming open (before this component ever mounts), so a reopened
  // screen never shows a stale prior session and no post-mount effect races a seeded render.
  const phase = resolveRegistryScreenPhase({
    registryScanStatus,
    registryScanResult,
    registryRegisterStatus,
    registryRegisterResults,
    registryCleanScanStatus,
    registryCleanCandidates,
    registryCleanStatus,
    registryCleanResults,
  });

  const [root, setRoot] = useState('');
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleanCursor, setCleanCursor] = useState(0);
  const [cleanExcluded, setCleanExcluded] = useState<Set<string>>(new Set());

  const candidates = registryScanResult?.candidates ?? [];
  const clampedCursor = candidates.length === 0 ? 0 : Math.min(cursor, candidates.length - 1);

  const staleCandidates = registryCleanCandidates ?? [];
  const clampedCleanCursor = staleCandidates.length === 0 ? 0 : Math.min(cleanCursor, staleCandidates.length - 1);
  const selectedStalePaths = staleCandidates.map((candidate) => candidate.path).filter((path) => !cleanExcluded.has(path));

  useInput((input, key) => {
    if (phase === 'root-input') {
      // Ctrl+L: "Clean stale entries" — never a plain "l" keypress, which must stay available
      // as ordinary root-path text (like branch-picker.tsx's Ctrl+R).
      if (key.ctrl && input.toLowerCase() === 'l') {
        void scanRegistryStaleEntries();
        return;
      }
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

    if (phase === 'clean-candidates' && staleCandidates.length > 0) {
      if (key.downArrow) {
        setCleanCursor((current) => moveCandidateCursor(current, 'down', staleCandidates.length));
        return;
      }
      if (key.upArrow) {
        setCleanCursor((current) => moveCandidateCursor(current, 'up', staleCandidates.length));
        return;
      }
      if (input === ' ') {
        const candidate = staleCandidates[clampedCleanCursor];
        if (candidate !== undefined) {
          setCleanExcluded((current) => toggleCleanCandidateExclusion(current, candidate.path));
        }
        return;
      }
      if (key.return) {
        if (selectedStalePaths.length > 0) {
          void removeStaleRegistryCandidates(selectedStalePaths);
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
            <DimAnnotation text="Type a path  [Enter] scan" />
            <DimAnnotation text="Ctrl+L to clean stale registry entries (unreachable or unmanaged)." />
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
                // checkbox-list-item.tsx's own `selected` prop has no visible effect, so the
                // highlighted (arrow-navigable) row gets a `›` cursor glyph as a sibling column,
                // matching list-row.tsx's selection marker, without modifying the shared
                // component.
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
            <DimAnnotation text="[Space] toggle  [Enter] register selection" />
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

        {phase === 'clean-candidates' ? (
          <Box flexDirection="column">
            {registryCleanScanStatus === 'loading' ? (
              <Box>
                <Spinner />
                <Text color={colors.text}> Scanning the registry for stale entries…</Text>
              </Box>
            ) : registryCleanScanStatus === 'error' ? (
              <Box flexDirection="column">
                <Text color={colors.error}>Scan failed.</Text>
                {registryCleanScanError ? <DimAnnotation text={registryCleanScanError} /> : null}
              </Box>
            ) : staleCandidates.length === 0 ? (
              // Zero candidates is an explicit, visible state, never silent — same convention
              // as the scan flow's own 'empty' phase.
              <Box flexDirection="column">
                <Text color={colors['text-dim']}>No stale registry entries found.</Text>
                {registryCleanErrors.length > 0 ? (
                  <DimAnnotation
                    text={`${registryCleanErrors.length} path(s) could not be checked and were left alone: ${registryCleanErrors
                      .map((error) => `${error.path} (${error.code})`)
                      .join(', ')}`}
                  />
                ) : null}
                <DimAnnotation text="Esc to close." />
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text color={colors['text-dim']}>STALE ENTRIES</Text>
                {staleCandidates.map((candidate, index) => {
                  const highlighted = index === clampedCleanCursor;
                  const memberNote =
                    candidate.memberOfEdts.length > 0 ? ` [member of EDT: ${candidate.memberOfEdts.join(', ')}]` : '';
                  return (
                    <Box key={candidate.path} flexDirection="row">
                      <Text color={colors.accent}>{highlighted ? '›' : ' '}</Text>
                      <CheckboxListItem
                        label={`${candidate.path} — ${candidate.reason}${memberNote}`}
                        selected={highlighted}
                        state={cleanExcluded.has(candidate.path) ? 'unchecked' : 'checked'}
                      />
                    </Box>
                  );
                })}
                {registryCleanErrors.length > 0 ? (
                  // A path that couldn't even be checked (registry.exists() errored) is never
                  // silently dropped — reported here, distinct from the removable candidate list
                  // above, never gating or blocking it.
                  <DimAnnotation
                    text={`${registryCleanErrors.length} path(s) could not be checked and were left alone: ${registryCleanErrors
                      .map((error) => `${error.path} (${error.code})`)
                      .join(', ')}`}
                  />
                ) : null}
                <DimAnnotation text="[Space] toggle  [Enter] remove selection" />
              </Box>
            )}
          </Box>
        ) : null}

        {phase === 'cleaning' ? (
          <Box>
            <Spinner />
            <Text color={colors.text}> Removing stale entries…</Text>
          </Box>
        ) : null}

        {phase === 'clean-results' ? (
          <Box flexDirection="column">
            <Text color={colors['text-dim']}>RESULTS</Text>
            {(registryCleanResults ?? []).map((result) => (
              <Box key={result.path} flexDirection="column">
                <Text color={colors.text}>
                  {result.path} — <Text color={staleOutcomeColor(result.outcome)}>{result.outcome}</Text>
                </Text>
                {result.detail ? <DimAnnotation text={result.detail.message} /> : null}
              </Box>
            ))}
            <DimAnnotation text="Esc to close." />
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
