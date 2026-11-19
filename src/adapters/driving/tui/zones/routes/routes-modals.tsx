// tui/zones/routes: routes-modals — the Routes zone's modal dialogs: overwrite confirm, saved-requests picker and the two delete confirms.
import { Box, Text } from 'ink';
import type { RoutesZoneCtx } from './routes-zone.ctx.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { FilterablePickList } from '../../shared/components/filterable-pick-list.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { colors } from '../../shared/theme/theme.js';
import { formatHints } from '../../shared/components/hints.js';

export function RoutesModals({ c }: { c: RoutesZoneCtx }) {
  const {
    savedRequests, overwriteConfirm, pickerOpen, pickerState, pickerError, pickerDeleteConfirm,
    savedTabDeleteConfirm, savedItems,
  } = c;
  return (
    <>
      {overwriteConfirm !== null ? (
          <ModalDialog title={`Overwrite "${overwriteConfirm.name}"?`}>
            <Box flexDirection="column">
              <ClampedParagraph color={colors.text} maxLines={4}>{`A saved request named "${overwriteConfirm.name}" already exists. Overwriting replaces it.`}</ClampedParagraph>
              <ClampedParagraph color={colors.text} maxLines={4}>{`${formatHints([['Enter', 'overwrite'], ['Esc', 'cancel']])}`}</ClampedParagraph>
            </Box>
          </ModalDialog>
        ) : null}
        {pickerOpen ? (
          <ModalDialog title="Saved requests">
            <Box flexDirection="column">
              {pickerError !== null ? <ClampedParagraph color={colors.error} maxLines={4}>{`${pickerError}`}</ClampedParagraph> : null}
              {savedRequests === null ? (
                <DimAnnotation text="Loading saved requests…" />
              ) : (
                <FilterablePickList
                  label="Filter"
                  state={pickerState}
                  items={savedItems}
                  emptyText="No saved requests yet — press s in the Request tab to save one."
                  noMatchText="No saved requests match."
                />
              )}
              <DimAnnotation text={formatHints([['Enter', 'load'], ['Esc', 'close'], ['d', 'delete stale']])} />
            </Box>
          </ModalDialog>
        ) : null}
        {pickerDeleteConfirm !== null ? (
          <ModalDialog title={`Delete "${pickerDeleteConfirm.name}"?`}>
            <Box flexDirection="column">
              <ClampedParagraph color={colors.text} maxLines={4}>{`The stale saved request "${pickerDeleteConfirm.name}" will be removed. This cannot be undone.`}</ClampedParagraph>
              <Text color={colors.text} wrap="truncate-end">{formatHints([['Enter', 'delete'], ['Esc', 'cancel']])}</Text>
            </Box>
          </ModalDialog>
        ) : null}
        {savedTabDeleteConfirm !== null ? (
          <ModalDialog title={`Delete "${savedTabDeleteConfirm.name}"?`}>
            <Box flexDirection="column">
              <ClampedParagraph color={colors.text} maxLines={4}>{`The saved request "${savedTabDeleteConfirm.name}" will be removed. This cannot be undone.`}</ClampedParagraph>
              <Text color={colors.text} wrap="truncate-end">{formatHints([['Enter', 'delete'], ['Esc', 'cancel']])}</Text>
            </Box>
          </ModalDialog>
        ) : null}
    </>
  );
}
