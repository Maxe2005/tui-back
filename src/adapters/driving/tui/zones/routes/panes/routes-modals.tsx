// tui/zones/routes: routes-modals — the Routes zone's modal dialogs: overwrite confirm, saved-requests picker and the two delete confirms.
import { Box, Text } from 'ink';
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import { ClampedParagraph } from '../../../shared/components/display/truncated-text.js';
import { DimAnnotation } from '../../../shared/components/feedback/dim-annotation.js';
import { FilterablePickList } from '../../../shared/components/pickers/filterable-pick-list.js';
import { ModalDialog } from '../../../shared/components/dialogs/modal-dialog.js';
import { colors } from '../../../shared/theme/theme.js';
import { formatHints } from '../../../shared/components/dialogs/hints.js';

export function RoutesModals({ c }: { c: RoutesZoneCtx }) {
  const {
    savedRequests, overwriteConfirm, pickerOpen, pickerState, pickerError, pickerDeleteConfirm,
    savedTabDeleteConfirm, savedItems, smokeConfirm,
  } = c;
  return (
    <>
      {smokeConfirm !== null ? (
          <ModalDialog title="Smoke run: include mutating routes?">
            <Box flexDirection="column">
              <ClampedParagraph color={colors.text} maxLines={4}>{'These favorites change data and would be fired:'}</ClampedParagraph>
              {smokeConfirm.routes.slice(0, 8).map((route) => (
                <Text key={route} color={colors.warning} wrap="truncate-end">{route}</Text>
              ))}
              {smokeConfirm.routes.length > 8 ? <DimAnnotation text={`… and ${smokeConfirm.routes.length - 8} more`} /> : null}
              <Text color={colors.text} wrap="truncate-end">{formatHints([['Enter', 'fire them too'], ['Esc', 'safe ones only']])}</Text>
            </Box>
          </ModalDialog>
        ) : null}
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
