// tui/zones/shared-types: the read-only History view over the shared-types source repo. By
// branch (version bumps newest first, streamed) or by version (bumping commit, containing
// branches, date). Rendering and key dispatch only: the searches live in core
// (`core/shared-types/version-history.ts`) and run through the store slice, which owns the
// cancellable walk. Enter on a row hands that version to the form.
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { BranchAutocompleteInput } from '../../shared/components/branch-autocomplete-input.js';
import { Spinner, StateLine, TextInputLine } from '../../shared/components/index.js';
import { ClampedParagraph, TruncatedText } from '../../shared/components/truncated-text.js';
import { useInput } from '../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../shared/hooks/use-zone-input-active.js';
import { colors } from '../../shared/theme/theme.js';
import {
  branchStatusLine,
  entryRow,
  hitRow,
  initialHistoryView,
  reduceHistoryKey,
  versionStatusLine,
  type HistoryView,
} from './shared-types-history.logic.js';

const HISTORY_CHROME_ROWS = 6;
const MAX_CLAMPED_LINES = 3;

export type HistoryUiState = { editing: boolean; searching: boolean };

export function SharedTypesHistory({
  useStore = useAppStore,
  onSelectVersion,
  onClose,
  onUiState,
}: {
  useStore?: AppStore;
  onSelectVersion: (version: string) => void;
  onClose: () => void;
  onUiState: (state: HistoryUiState) => void;
}) {
  const history = useStore((state) => state.sharedTypesHistory);
  const branches = useStore((state) => state.sharedTypesHistoryBranches);
  const branchesStatus = useStore((state) => state.sharedTypesHistoryBranchesStatus);
  const dropdownRows = useStore((state) => state.settings.edts.branchDropdownMaxRows);
  const startSearch = useStore((state) => state.startSharedTypesHistorySearch);
  const cancelSearch = useStore((state) => state.cancelSharedTypesHistorySearch);
  const resetHistory = useStore((state) => state.resetSharedTypesHistory);
  const loadBranches = useStore((state) => state.loadSharedTypesHistoryBranches);
  const zoneInputActive = useZoneInputActive(useStore);
  const [view, setView] = useState<HistoryView>(initialHistoryView);
  // The mode the next search uses; the store's own mode only follows a started search.
  const [mode, setMode] = useState<'branch' | 'version'>(history.mode);

  useEffect(() => {
    void loadBranches();
    return () => resetHistory();
  }, [loadBranches, resetHistory]);

  const searching = history.status === 'searching';
  useEffect(() => {
    onUiState({ editing: view.editing, searching });
  }, [view.editing, searching, onUiState]);

  const resultsMode = history.mode === mode;
  const rowVersions = !resultsMode
    ? []
    : mode === 'branch'
      ? history.entries.map((entry) => entry.version)
      : history.hits.map(() => history.query);

  useInput((input, key) => {
    const step = reduceHistoryKey(view, { mode, searching, branches, rowVersions }, input, key);
    setView(step.view);
    const { action } = step;
    if (action.type === 'close') {
      onClose();
    } else if (action.type === 'cancel') {
      cancelSearch();
    } else if (action.type === 'switch-mode') {
      resetHistory();
      setMode(mode === 'branch' ? 'version' : 'branch');
    } else if (action.type === 'search') {
      void startSearch({ mode, query: action.query });
    } else if (action.type === 'select') {
      onSelectVersion(action.version);
    }
  }, { isActive: zoneInputActive });

  const title = mode === 'branch' ? 'HISTORY by branch (Tab: by version)' : 'HISTORY by version (Tab: by branch)';
  const status = !resultsMode ? null : mode === 'branch' ? branchStatusLine(history) : versionStatusLine(history);
  const rows = !resultsMode ? 0 : mode === 'branch' ? history.entries.length : history.hits.length;
  return (
    <Box flexDirection="column">
      <Box>
        {searching ? <Spinner /> : null}
        <TruncatedText color={colors['text-dim']}>{searching ? ` ${title}` : title}</TruncatedText>
      </Box>
      {mode === 'branch' ? (
        <BranchAutocompleteInput
          label="Branch"
          state={view.branch}
          subject="branches"
          branches={branches}
          branchesStatus={branchesStatus === 'idle' ? 'loading' : branchesStatus}
          maxLines={dropdownRows}
          focused
          editing={view.editing}
        />
      ) : (
        <TextInputLine label="Version" value={view.version.value} cursor={view.version.cursor} focused={view.editing} highlighted />
      )}
      {view.inputError !== null ? <ClampedParagraph color={colors.error} maxLines={MAX_CLAMPED_LINES}>{view.inputError}</ClampedParagraph> : null}
      {resultsMode && history.status === 'error' && history.error !== null ? (
        <Box flexDirection="column">
          <ClampedParagraph color={colors.error} maxLines={MAX_CLAMPED_LINES}>{`[${history.error.code}] ${history.error.message}`}</ClampedParagraph>
          <Text color={colors['text-dim']} wrap="truncate-end">Search again with Enter</Text>
        </Box>
      ) : null}
      {resultsMode && history.status === 'searching' && rows === 0 ? <StateLine kind="loading" subject="history" /> : null}
      {mode === 'branch' ? (
        <BoundedList
          items={resultsMode ? history.entries : []}
          chromeRows={HISTORY_CHROME_ROWS + (view.editing ? dropdownRows + 2 : 0)}
          cursorIndex={view.editing ? undefined : view.row}
          renderItem={(entry, index) => (
            <Box key={`${entry.commit}:${String(index)}`}>
              <Text color={!view.editing && index === view.row ? colors.accent : colors.text} wrap="truncate-end">{!view.editing && index === view.row ? '> ' : '  '}</Text>
              <TruncatedText color={!view.editing && index === view.row ? colors.accent : colors.text}>{entryRow(entry)}</TruncatedText>
            </Box>
          )}
        />
      ) : (
        <BoundedList
          items={resultsMode ? history.hits : []}
          chromeRows={HISTORY_CHROME_ROWS}
          cursorIndex={view.editing ? undefined : view.row}
          renderItem={(hit, index) => (
            <Box key={`${hit.commit}:${String(index)}`}>
              <Text color={!view.editing && index === view.row ? colors.accent : colors.text} wrap="truncate-end">{!view.editing && index === view.row ? '> ' : '  '}</Text>
              <TruncatedText color={!view.editing && index === view.row ? colors.accent : colors.text}>{hitRow(hit)}</TruncatedText>
            </Box>
          )}
        />
      )}
      {status !== null ? <TruncatedText color={history.status === 'done' && history.found === false ? colors.warning : colors['text-dim']}>{status}</TruncatedText> : null}
    </Box>
  );
}
