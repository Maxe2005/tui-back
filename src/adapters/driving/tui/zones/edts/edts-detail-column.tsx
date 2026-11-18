// tui/zones/edts: edts-detail-column — the right column: a DetailPane for whichever list pane is
// focused (DetailPane takes only Text-safe content, so a git-error detail is a DimAnnotation
// sibling).
import { Box } from 'ink';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { StateLine } from '../../shared/components/state-line.js';
import { spacing } from '../../shared/theme/theme.js';
import {
  appendHint,
  formatEdtActionHistory,
  formatEdtDetail,
  formatServiceDetail,
  resolveActionHint,
} from './edts-zone.logic.js';
import type { EdtsZoneCtx } from './edts-zone.ctx.js';

export function EdtsDetailColumn({ c }: { c: EdtsZoneCtx }) {
  const {
    paneFocus,
    focusedEdt,
    activeEdtUlid,
    edtActionLog,
    currentEdtAction,
    hiddenActionTypes,
    hiddenActionHints,
    edtsStatus,
    edtsError,
    edtActionLogStatus,
    focusedEdtService,
    focusedOtherService,
    status,
    error,
  } = c;
  return (
          <Box flexDirection="column" minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            {paneFocus === 'edts' ? (
              <>
                <DetailPane title={focusedEdt ? focusedEdt.topic : 'EDT'}>
                  {focusedEdt
                    ? formatEdtDetail(focusedEdt, focusedEdt.ulid === activeEdtUlid) +
                      '\n\n' +
                      formatEdtActionHistory(edtActionLog, currentEdtAction, hiddenActionTypes) +
                      appendHint(resolveActionHint('edts', focusedEdt.ulid === activeEdtUlid, hiddenActionHints))
                    : 'No EDT selected.'}
                </DetailPane>
                {edtsStatus === 'error' && edtsError ? <DimAnnotation text={edtsError} /> : null}
                {edtActionLogStatus === 'loading' && <StateLine kind="loading" subject="action history" />}
                {edtActionLogStatus === 'error' && <StateLine kind="error" subject="action history" />}
              </>
            ) : paneFocus === 'edt-services' ? (
              <>
                <DetailPane title={focusedEdtService ? focusedEdtService.service : 'Service'}>
                  {(focusedEdtService ? formatServiceDetail(focusedEdtService) : 'No service selected.') +
                    appendHint(resolveActionHint('edt-services', false, hiddenActionHints))}
                </DetailPane>
                {focusedEdtService?.detail ? <DimAnnotation text={focusedEdtService.detail.message} /> : null}
                {status === 'error' && error ? <DimAnnotation text={error} /> : null}
              </>
            ) : (
              <>
                <DetailPane title={focusedOtherService ? focusedOtherService.service : 'Service'}>
                  {(focusedOtherService ? formatServiceDetail(focusedOtherService) : 'No service selected.') +
                    appendHint(resolveActionHint('other-services', false, hiddenActionHints))}
                </DetailPane>
                {focusedOtherService?.detail ? <DimAnnotation text={focusedOtherService.detail.message} /> : null}
                {status === 'error' && error ? <DimAnnotation text={error} /> : null}
              </>
            )}
          </Box>
  );
}
