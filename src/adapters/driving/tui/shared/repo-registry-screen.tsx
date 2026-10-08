// tui/shared/repo-registry-screen: an overlay (not a zone tab) over the scan/register
// use-cases, opened via the store's registryScreenOpen flag by the `registry` command or
// Dashboard's empty-registry prompt. Ctrl+L opens "Clean stale entries": classify
// unreachable/manifest-not-found entries and remove the confirmed ones. Every key decision is a
// pure function because renderToString's fake stdin never emits keys.
import { useState } from 'react';
import { Box, Text, type Key } from 'ink';
import { useInput } from './hooks/use-input.js';
import { CheckboxListItem } from './components/checkbox-list-item.js';
import { DimAnnotation } from './components/dim-annotation.js';
import { ModalDialog } from './components/modal-dialog.js';
import { StateLine } from './components/state-line.js';
import { nextCursorForKey } from './keys/list-cursor.js';
import { useFooterContext } from './hooks/use-footer-context.js';
import type { FooterContextId } from '../keybindings/index.js';
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
import { BoundedBlocks, BoundedList } from './components/bounded-list.js';

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

// The footer context of a phase: only the three interactive phases advertise their own keys, every
// other one just closes with Esc.
export function registryFooterContext(phase: RegistryScreenPhase, hasStaleCandidates: boolean): FooterContextId {
  if (phase === 'root-input') {
    return 'registry-path';
  }
  if (phase === 'candidates') {
    return 'registry-candidates';
  }
  return phase === 'clean-candidates' && hasStaleCandidates ? 'registry-stale' : 'dismiss';
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

// Rows the screen keeps around its list: frame, guidance lines, heading, hint.
const REGISTRY_CHROME_ROWS = 14;
// A result's path line plus up to three annotation lines.
const DETAIL_BLOCK_ROWS = 4;

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

  const rootLabel = root.trim() === '' ? 'the root path' : root;
  const candidates = registryScanResult?.candidates ?? [];
  const clampedCursor = candidates.length === 0 ? 0 : Math.min(cursor, candidates.length - 1);

  const staleCandidates = registryCleanCandidates ?? [];
  const clampedCleanCursor = staleCandidates.length === 0 ? 0 : Math.min(cleanCursor, staleCandidates.length - 1);
  const selectedStalePaths = staleCandidates.map((candidate) => candidate.path).filter((path) => !cleanExcluded.has(path));

  useFooterContext('registry', registryFooterContext(phase, staleCandidates.length > 0), useStore);

  useInput((input, key) => {
    if (phase === 'root-input') {
      // Ctrl+L: "Clean stale entries" — never a plain "l" keypress, which must stay available
      // as ordinary root-path text (like branch-picker.tsx's Ctrl+T).
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
      const moved = nextCursorForKey(key, clampedCursor, candidates.length);
      if (moved !== null) {
        setCursor(moved);
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
      const moved = nextCursorForKey(key, clampedCleanCursor, staleCandidates.length);
      if (moved !== null) {
        setCleanCursor(moved);
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
    <ModalDialog title="REPO REGISTRY" open>
      <Box flexDirection="column">
        <Box flexDirection="column">
          {MANIFEST_GUIDANCE_LINES.map((line) => (
            <DimAnnotation key={line} text={line} />
          ))}
        </Box>

        {phase === 'root-input' ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">
              Root path: <Text color={colors.accent}>{root}</Text>
              <Text color={colors['text-dim']}>█</Text>
            </Text>
            <DimAnnotation text="Type a path. Stale registry entries (unreachable or unmanaged) can be cleaned too." />
          </Box>
        ) : null}

        {phase === 'scanning' ? (
          <StateLine kind="loading" verb="Scanning" subject={rootLabel} />
        ) : null}

        {phase === 'scan-error' ? (
          <Box flexDirection="column">
            <StateLine kind="error" verb="Failed to scan" subject={rootLabel} />
            {registryScanError ? <DimAnnotation text={registryScanError} /> : null}
          </Box>
        ) : null}

        {phase === 'empty' ? (
          <StateLine kind="empty" subject="manifest-carrying repos" text="No manifest-carrying repos found here." />
        ) : null}

        {phase === 'candidates' ? (
          <Box flexDirection="column">
            <Text color={colors['text-dim']}>CANDIDATES</Text>
            <BoundedList
              items={candidates}
              chromeRows={REGISTRY_CHROME_ROWS}
              cursorIndex={clampedCursor}
              renderItem={(path, index) => {
              const highlighted = index === clampedCursor;
              return (
                // checkbox-list-item.tsx's own `selected` prop has no visible effect, so the
                // highlighted (arrow-navigable) row gets a `›` cursor glyph as a sibling column,
                // matching list-row.tsx's selection marker, without modifying the shared
                // component.
                <Box key={path} flexDirection="row">
                  <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                  <CheckboxListItem
                    label={path}
                    selected={highlighted}
                    state={selected.has(path) ? 'checked' : 'unchecked'}
                  />
                </Box>
              );
              }}
            />
          </Box>
        ) : null}

        {phase === 'registering' ? (
          <StateLine kind="loading" verb="Registering" subject="" />
        ) : null}

        {phase === 'results' ? (
          <Box flexDirection="column">
            <Text color={colors['text-dim']}>RESULTS</Text>
            <BoundedBlocks
              chromeRows={REGISTRY_CHROME_ROWS}
              blocks={(registryRegisterResults ?? []).map((result) => ({
                key: result.path,
                rows: result.detail ? DETAIL_BLOCK_ROWS : 1,
                node: (
                  <Box flexDirection="column">
                    <Text color={colors.text} wrap="truncate-end">
                      {result.path} — <Text color={outcomeColor(result.outcome)}>{result.outcome}</Text>
                    </Text>
                    {result.detail ? <DimAnnotation text={result.detail} /> : null}
                  </Box>
                ),
              }))}
            />
          </Box>
        ) : null}

        {phase === 'clean-candidates' ? (
          <Box flexDirection="column">
            {registryCleanScanStatus === 'loading' ? (
              <StateLine kind="loading" verb="Scanning" subject="the registry for stale entries" />
            ) : registryCleanScanStatus === 'error' ? (
              <Box flexDirection="column">
                <StateLine kind="error" verb="Failed to scan" subject="the registry for stale entries" />
                {registryCleanScanError ? <DimAnnotation text={registryCleanScanError} /> : null}
              </Box>
            ) : staleCandidates.length === 0 ? (
              // Zero candidates is an explicit, visible state, never silent — same convention
              // as the scan flow's own 'empty' phase.
              <Box flexDirection="column">
                <StateLine kind="empty" subject="stale registry entries" text="No stale registry entries found." />
                {registryCleanErrors.length > 0 ? (
                  <DimAnnotation
                    text={`${registryCleanErrors.length} path(s) could not be checked and were left alone: ${registryCleanErrors
                      .map((error) => `${error.path} (${error.code})`)
                      .join(', ')}`}
                  />
                ) : null}
              </Box>
            ) : (
              <Box flexDirection="column">
                <Text color={colors['text-dim']}>STALE ENTRIES</Text>
                <BoundedList
                  items={staleCandidates}
                  chromeRows={REGISTRY_CHROME_ROWS + 2}
                  cursorIndex={clampedCleanCursor}
                  renderItem={(candidate, index) => {
                  const highlighted = index === clampedCleanCursor;
                  const memberNote =
                    candidate.memberOfEdts.length > 0 ? ` [member of EDT: ${candidate.memberOfEdts.join(', ')}]` : '';
                  return (
                    <Box key={candidate.path} flexDirection="row">
                      <Text color={colors.accent} wrap="truncate-end">{highlighted ? '›' : ' '}</Text>
                      <CheckboxListItem
                        label={`${candidate.path} — ${candidate.reason}${memberNote}`}
                        selected={highlighted}
                        state={cleanExcluded.has(candidate.path) ? 'unchecked' : 'checked'}
                      />
                    </Box>
                  );
                  }}
                />
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
              </Box>
            )}
          </Box>
        ) : null}

        {phase === 'cleaning' ? (
          <StateLine kind="loading" verb="Removing" subject="stale entries" />
        ) : null}

        {phase === 'clean-results' ? (
          <Box flexDirection="column">
            <Text color={colors['text-dim']}>RESULTS</Text>
            <BoundedBlocks
              chromeRows={REGISTRY_CHROME_ROWS}
              blocks={(registryCleanResults ?? []).map((result) => ({
                key: result.path,
                rows: result.detail ? DETAIL_BLOCK_ROWS : 1,
                node: (
                  <Box flexDirection="column">
                    <Text color={colors.text} wrap="truncate-end">
                      {result.path} — <Text color={staleOutcomeColor(result.outcome)}>{result.outcome}</Text>
                    </Text>
                    {result.detail ? <DimAnnotation text={result.detail.message} /> : null}
                  </Box>
                ),
              }))}
            />
          </Box>
        ) : null}
      </Box>
    </ModalDialog>
  );
}
