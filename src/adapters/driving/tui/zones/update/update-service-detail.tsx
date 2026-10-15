// tui/zones/update: the per-service detail pane. While an update processes the service it
// shows each step (merge, migration, restart) live — waiting, in progress, done or failed — with
// the open issues; otherwise it shows the service's last update: where it came from and went,
// then the settled result of each step, spaced and glyph-prefixed. Pure view over
// buildServiceStepViews; the zone decides which mode applies.
import { Box, Text } from 'ink';
import { useBounds } from '../../shared/bounds/bounds-context.js';
import { capOlder, OlderHiddenLine } from '../../shared/components/bounded-list.js';
import { Spinner } from '../../shared/components/index.js';
import { colors } from '../../shared/theme/theme.js';
import type { SharedTypesStage } from '../../../../../core/shared-types/smart-update.js';
import type { GroupUpdateRepoResult } from '../../../../../core/scripts/group-update.js';
import {
  buildServiceStepViews,
  PENDING_STEPS,
  type ServiceIssue,
  type ServiceStepStates,
  type UpdateStepState,
} from './update-zone.logic.js';

export const UPDATE_DETAIL_NEVER_RAN = 'No update has run for this service yet.';

const STEP_COLORS: Record<UpdateStepState, string> = {
  pending: colors['text-dim'],
  running: colors.info,
  done: colors.success,
  failed: colors.error,
  skipped: colors['text-dim'],
};

// merge, migration, restart.
const MAX_STEP_VIEWS = 3;
const MAX_STEP_DETAIL_LINES = 4;
// Rows of the pane the issue log leaves to the rest of the detail.
const ISSUE_LOG_CHROME_ROWS = 16;

// The issue log is stream-fed: only the newest issues show, with the count of older ones.
function IssueLog({ issues }: { issues: readonly ServiceIssue[] }) {
  const { rows } = useBounds();
  const { items: visibleIssues, hidden } = capOlder(issues, Math.max(3, rows - ISSUE_LOG_CHROME_ROWS));
  return (
    <>
      <OlderHiddenLine hidden={hidden} />
      {visibleIssues.map((issue, index) => (
        <Text key={`${issue.kind}-${index}`} color={issue.resolved ? colors['text-dim'] : colors.warning} wrap="truncate-end">
          {'   '}
          {issue.resolved ? '✔' : '⚠'} {issue.kind} — {issue.detail.replace(/\s+/g, ' ')} ({issue.resolved ? 'resolved' : 'needs your input'})
        </Text>
      ))}
    </>
  );
}

export interface UpdateServiceDetailProps {
  service: string;
  mode: 'live' | 'last' | 'never';
  // Pre-formatted "source → target (EDT topic)" line, absent when no context is known.
  context: string | null;
  steps: ServiceStepStates | undefined;
  result: GroupUpdateRepoResult | undefined;
  issues: readonly ServiceIssue[];
  // The `shared-types` phase running after this service's own update, when it is the source.
  sharedTypesStage?: SharedTypesStage;
}

export function UpdateServiceDetail({ service, mode, context, steps, result, issues, sharedTypesStage }: UpdateServiceDetailProps) {
  const views = buildServiceStepViews(steps ?? PENDING_STEPS, result);
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={colors.text} wrap="truncate-end">
          {service}
        </Text>
        {mode === 'live' ? (
          <Box marginLeft={2}>
            <Spinner />
            <Text color={colors.info}> UPDATE IN PROGRESS</Text>
          </Box>
        ) : mode === 'last' ? (
          <Text color={colors['text-dim']}>{'  · last update'}</Text>
        ) : null}
      </Box>
      {mode === 'never' ? (
        <Text color={colors['text-dim']} wrap="truncate-end">{UPDATE_DETAIL_NEVER_RAN}</Text>
      ) : (
        <Box flexDirection="column">
          {context !== null ? <Text color={colors.text} wrap="truncate-end">{context}</Text> : null}
          {sharedTypesStage !== undefined ? <Text color={colors.info} bold wrap="truncate-end">{`step: ${sharedTypesStage} shared-types`}</Text> : null}
          {views.slice(0, MAX_STEP_VIEWS).map((view) => (
            <Box key={view.key} flexDirection="column" marginTop={1}>
              <Text color={STEP_COLORS[view.state]} bold={view.state === 'running'} wrap="truncate-end">
                {view.headline}
              </Text>
              {view.detail.slice(0, MAX_STEP_DETAIL_LINES).map((line) => (
                <Text key={line} color={colors['text-dim']} wrap="truncate-end">
                  {'   '}
                  {line}
                </Text>
              ))}
              {view.key === 'merge'
                ? <IssueLog issues={issues} />
                : null}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
