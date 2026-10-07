// tui/zones/update: the per-service detail pane. While an update processes the service it
// shows each step (merge, migration, restart) live — waiting, in progress, done or failed — with
// the open issues; otherwise it shows the service's last update: where it came from and went,
// then the settled result of each step, spaced and glyph-prefixed. Pure view over
// buildServiceStepViews; the zone decides which mode applies.
import { Box, Text } from 'ink';
import { Spinner } from '../../shared/components/index.js';
import { colors } from '../../shared/theme/theme.js';
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

export interface UpdateServiceDetailProps {
  service: string;
  mode: 'live' | 'last' | 'never';
  // Pre-formatted "source → target (EDT topic)" line, absent when no context is known.
  context: string | null;
  steps: ServiceStepStates | undefined;
  result: GroupUpdateRepoResult | undefined;
  issues: readonly ServiceIssue[];
}

export function UpdateServiceDetail({ service, mode, context, steps, result, issues }: UpdateServiceDetailProps) {
  const views = buildServiceStepViews(steps ?? PENDING_STEPS, result);
  return (
    <Box flexDirection="column">
      <Box>
        <Text bold color={colors.text}>
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
        <Text color={colors['text-dim']}>{UPDATE_DETAIL_NEVER_RAN}</Text>
      ) : (
        <Box flexDirection="column">
          {context !== null ? <Text color={colors.text}>{context}</Text> : null}
          {views.map((view) => (
            <Box key={view.key} flexDirection="column" marginTop={1}>
              <Text color={STEP_COLORS[view.state]} bold={view.state === 'running'}>
                {view.headline}
              </Text>
              {view.detail.map((line) => (
                <Text key={line} color={colors['text-dim']}>
                  {'   '}
                  {line}
                </Text>
              ))}
              {view.key === 'merge'
                ? issues.map((issue, index) => (
                    <Text key={`${issue.kind}-${index}`} color={issue.resolved ? colors['text-dim'] : colors.warning}>
                      {'   '}
                      {issue.resolved ? '✔' : '⚠'} {issue.kind} — {issue.detail.replace(/\s+/g, ' ')} ({issue.resolved ? 'resolved' : 'needs your input'})
                    </Text>
                  ))
                : null}
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
