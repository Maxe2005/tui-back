// tui/zones/update: update-detail-column — the zone's right column: the selected service's live /
// last-run detail, the running spinner, the incident toast, the notice and error lines, and the
// last-update recap states (running, done, idle) shown while service focus is dropped.
import { Box, Text } from 'ink';
import { BoundedList, DetailPane, Spinner } from '../../shared/components/index.js';
import { StateLine } from '../../shared/components/state-line.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import { formatServiceUpdateContext } from './update-zone.logic.js';
import { UpdateServiceDetail } from './update-service-detail.js';
import {
  UPDATE_ALL_REPOS_PROMPT,
  UPDATE_IDLE_PROMPT,
  UPDATE_INTERRUPTED_OFFER,
  UPDATE_NO_RECAP,
  formatUpdateSummary,
  resolveUpdateTone,
} from './update-zone.resolvers.logic.js';
import { RECAP_CHROME_ROWS, RECAP_CONTEXT_MAX_LINES, RUNNING_LIST_CHROME_ROWS, type UpdateZoneCtx } from './update-zone.ctx.js';

export function UpdateDetailColumn({ c }: { c: UpdateZoneCtx }) {
  const {
    recapActive, selectedServiceRow, isSelectedRestarting, isSelectedTargeted, selectedRun, selectedLastOutcome,
    liveServiceSteps, liveSharedTypesPhase, selectedLiveIssues, detailBody, updateStatus, runningLabel, incidentToast,
    updateNotice, updateNote, updateError, updateErrorCode, runningSelectedRows, isAllRun, runningMembers, updateTopic, updateResults,
    recap, recapCursor, offerRerun,
  } = c;
  return (
    <Box flexDirection="column" minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
      {!recapActive ? (
        selectedServiceRow !== undefined &&
        !isSelectedRestarting &&
        (isSelectedTargeted || selectedRun !== undefined || selectedLastOutcome === undefined) ? (
          <UpdateServiceDetail
            service={selectedServiceRow.service}
            mode={isSelectedTargeted ? 'live' : selectedRun !== undefined ? 'last' : 'never'}
            context={
              selectedRun !== undefined && !isSelectedTargeted
                ? formatServiceUpdateContext(selectedRun.source, selectedRun.target, selectedRun.topic)
                : null
            }
            steps={isSelectedTargeted ? (liveServiceSteps[selectedServiceRow.service] ?? (liveSharedTypesPhase[selectedServiceRow.service] !== undefined ? selectedRun?.steps : undefined)) : selectedRun?.steps}
            sharedTypesStage={isSelectedTargeted ? liveSharedTypesPhase[selectedServiceRow.service] : undefined}
            result={isSelectedTargeted ? undefined : selectedRun?.result}
            issues={selectedLiveIssues}
          />
        ) : (
          <DetailPane title={selectedServiceRow !== undefined ? selectedServiceRow.service : 'Service'}>{detailBody}</DetailPane>
        )
      ) : null}
      {!recapActive && updateStatus === 'running' ? (
        <Box>
          <Spinner />
          <Text color={colors.text} wrap="truncate-end"> {runningLabel}</Text>
        </Box>
      ) : null}
      {incidentToast !== null ? (
        <Text color={colors.warning} wrap="truncate-end">
          ◐ {incidentToast} — press i
        </Text>
      ) : null}
      {updateNotice !== null ? (
        <Text color={colors.warning} wrap="truncate-end">
          ⚠ {updateNotice.message} ({updateNotice.code})
        </Text>
      ) : null}
      {updateStatus === 'error' ? (
        <Box flexDirection="column">
          <ClampedParagraph color={colors.error} maxLines={4}>{`${updateError ?? 'Group update failed.'}${updateErrorCode !== null ? ` (code: ${updateErrorCode})` : ''}`}</ClampedParagraph>
          {recapActive ? <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_IDLE_PROMPT}</Text> : null}
        </Box>
      ) : null}
      {recapActive ? (
        <Box flexDirection="column">
          {updateStatus === 'running' ? (
            <Box flexDirection="column">
              <Box>
                <Spinner />
                <Text color={colors.text} wrap="truncate-end"> {runningLabel}</Text>
              </Box>
              {runningSelectedRows.length > 0 ? (
                <BoundedList
                  items={runningSelectedRows}
                  chromeRows={RUNNING_LIST_CHROME_ROWS}
                  renderItem={(row) => (
                    <Box key={row.path}>
                      <Spinner />
                      <Text color={colors.text} wrap="truncate-end"> {row.service}{row.branch !== null ? ` (${row.branch})` : ''}</Text>
                    </Box>
                  )}
                />
              ) : isAllRun || runningMembers.length === 0 ? (
                <StateLine kind="loading" subject="member services" />
              ) : (
                <BoundedList
                  items={runningMembers}
                  chromeRows={RUNNING_LIST_CHROME_ROWS}
                  renderItem={(member) => (
                    <Box key={member.repoPath}>
                      <Spinner />
                      <Text color={colors.text} wrap="truncate-end"> {member.service} ({member.branch})</Text>
                    </Box>
                  )}
                />
              )}
        </Box>
      ) : null}
      {updateStatus === 'done' && updateTopic !== null ? (
        // The zero-member no-op carries its note as the primary outcome line — rendering
        // the success-toned `0 updated, 0 skipped, 0 failed` counts DetailPane for it
        // would overstate a no-op as a result.
        updateNote !== null && updateResults.length === 0 ? (
          <Box flexDirection="column">
            <Text color={colors.text} wrap="truncate-end">{updateNote}</Text>
            <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_IDLE_PROMPT}</Text>
          </Box>
        ) : (
          <Box flexDirection="column">
            {recap !== null ? (
              <Box flexDirection="column">
                <Text bold color={colors.text} wrap="truncate-end">
                  {recap.title}
                </Text>
                {recap.contextLines.slice(0, RECAP_CONTEXT_MAX_LINES).map((line) => (
                  <Text key={line} color={colors['text-dim']} wrap="truncate-end">
                    {line}
                  </Text>
                ))}
                <BoundedList
                  items={recap.resultLines}
                  chromeRows={RECAP_CHROME_ROWS}
                  cursorIndex={Math.min(recapCursor, Math.max(0, recap.resultLines.length - 1))}
                  renderItem={(line, index) => (
                    // Duplicate service names occur within one EDT — key by line + index.
                    <Text key={`${line}-${index}`} color={colors.text} wrap="truncate-end">
                      {line}
                    </Text>
                  )}
                />
              </Box>
            ) : null}
            <DetailPane
              title={updateTopic === 'all-repos' ? 'All-repos update' : 'Group update'}
              summary={{ tone: resolveUpdateTone(updateResults), text: formatUpdateSummary(updateTopic, updateResults) }}
            >
              {updateNote ?? UPDATE_IDLE_PROMPT}
            </DetailPane>
          </Box>
        )
      ) : null}
      {updateStatus === 'idle' ? (
        <Box flexDirection="column">
          <Text color={colors.text} wrap="truncate-end">{offerRerun ? UPDATE_INTERRUPTED_OFFER : UPDATE_IDLE_PROMPT}</Text>
          <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_ALL_REPOS_PROMPT}</Text>
          <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_NO_RECAP}</Text>
        </Box>
      ) : null}
        </Box>
      ) : null}
    </Box>
  );
}
