// tui/zones/shared-types: propagate a version of the shared dependency to the active EDT's
// consuming services. A `disabled` tab shows its explanatory message; otherwise the zone is the
// form (version field pre-filled `0.1.`, consumer checklist, option toggles), then the run view
// (live step with spinner), then per-service results with independent retry. `q` mid-run asks
// for confirmation. The use-cases live in core; this file renders and dispatches keys.
import { useEffect, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { SHARED_TYPES_MODULE_IDS } from '../../../../../core/edt/resolve-tab-visibility.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { CheckboxListItem, ModalDialog, Spinner, StateLine, TextInputLine } from '../../shared/components/index.js';
import { useFooterContext } from '../../shared/hooks/use-footer-context.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  OPTION_ROWS,
  STEP_LABELS,
  initialFormState,
  reduceForm,
  resolveQuitDecision,
  selectedRepoPaths,
  shouldConfirmQuit,
  summarizeResult,
  type FormState,
} from './shared-types-zone.logic.js';

// The singular-carrier phrasing names the source id specifically; the plural phrasing (module
// identity ambiguous across several carriers) names both ids generically instead.
const [SOURCE_MODULE_ID] = SHARED_TYPES_MODULE_IDS;

export const SHARED_TYPES_QUIT_TITLE = 'QUIT MID-RUN';
export const SHARED_TYPES_QUIT_BODY = 'A version propagation is in progress. Quit anyway? Services already processed stay as they are.';
export const SHARED_TYPES_NO_MEMBERS = 'No service of the active EDT consumes the shared dependency — nothing to propagate.';

export function formatSharedTypesDisabledMessage(carryingServices: string[]): string {
  const list = carryingServices.join(', ');
  if (carryingServices.length === 1) {
    return `The repo ${list} (which imports the ${SOURCE_MODULE_ID} module) is not part of your active EDT.`;
  }
  return `None of the following repos (which import ${SHARED_TYPES_MODULE_IDS.join(' or ')}) are part of your active EDT: ${list}.`;
}

export function SharedTypesZone({ useStore = useAppStore }: { useStore?: AppStore }) {
  const status = useStore((state) => state.tabVisibility.sharedTypes.status);
  const carryingServices = useStore((state) => state.tabVisibility.sharedTypes.carryingServices);

  if (status === 'disabled') {
    return (
      <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
        <Text color={colors.text}>{formatSharedTypesDisabledMessage(carryingServices)}</Text>
      </Box>
    );
  }

  return <SharedTypesPanel useStore={useStore} />;
}

function SharedTypesPanel({ useStore }: { useStore: AppStore }) {
  const consumers = useStore((state) => state.sharedTypesConsumers);
  const issues = useStore((state) => state.sharedTypesIssues);
  const consumersStatus = useStore((state) => state.sharedTypesConsumersStatus);
  const consumersError = useStore((state) => state.sharedTypesConsumersError);
  const run = useStore((state) => state.sharedTypesRun);
  const loadConsumers = useStore((state) => state.loadSharedTypesConsumers);
  const runPropagation = useStore((state) => state.runSharedTypesPropagation);
  const retryService = useStore((state) => state.retrySharedTypesService);
  const resetRun = useStore((state) => state.resetSharedTypesRun);
  const requestQuit = useStore((state) => state.requestQuit);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const activeEdt = useStore((state) => state.activeEdt);

  const [form, setForm] = useState<FormState>(initialFormState);
  const [resultRow, setResultRow] = useState(0);
  const [quitConfirm, setQuitConfirm] = useState(false);

  useEffect(() => {
    void loadConsumers();
  }, [loadConsumers, activeEdt]);

  const repoPaths = consumers.map((consumer) => consumer.repoPath);
  const onVersionField = run.status === 'idle' && consumersStatus === 'ready' && consumers.length > 0 && form.row === 0;

  // The version field types freely (letters included), and a quit confirmation owns the keys.
  useEffect(() => {
    setZoneInputCaptured(quitConfirm || onVersionField);
    return () => setZoneInputCaptured(false);
  }, [quitConfirm, onVersionField, setZoneInputCaptured]);

  useFooterContext(
    'shared-types',
    quitConfirm
      ? 'confirm'
      : run.status === 'running'
        ? 'busy'
        : run.status === 'done'
          ? 'shared-types-results'
          : run.status === 'idle' && consumersStatus === 'ready' && consumers.length > 0
            ? onVersionField
              ? 'shared-types-version'
              : 'shared-types-form'
            : null,
    useStore,
  );

  useInput((input, key) => {
    if (quitConfirm) {
      const decision = resolveQuitDecision(input, key);
      if (decision === 'confirm') {
        setQuitConfirm(false);
        requestQuit();
      } else if (decision === 'cancel') {
        setQuitConfirm(false);
      }
      return;
    }
    if (shouldConfirmQuit(input, run.status)) {
      setQuitConfirm(true);
      return;
    }
    if (run.status === 'running') {
      return;
    }
    if (run.status === 'blocked') {
      if (key.return === true || key.escape === true) {
        resetRun();
      }
      return;
    }
    if (run.status === 'done') {
      if (key.upArrow === true) {
        setResultRow((row) => Math.max(0, row - 1));
      } else if (key.downArrow === true) {
        setResultRow((row) => Math.min(run.results.length - 1, row + 1));
      } else if ((input === 'r' || input === 'R') && run.results[resultRow]?.outcome === 'failed') {
        void retryService(run.results[resultRow]!.repoPath);
      } else if (key.escape === true || input === 'n') {
        setResultRow(0);
        resetRun();
      }
      return;
    }
    if (consumersStatus === 'error' && (input === 'R' || input === 'r')) {
      void loadConsumers();
      return;
    }
    if (consumersStatus !== 'ready' || consumers.length === 0) {
      return;
    }
    const step = reduceForm(form, input, key, repoPaths);
    setForm(step.state);
    if (step.run) {
      setResultRow(0);
      void runPropagation({
        version: step.state.version.value.trim(),
        repoPaths: selectedRepoPaths(step.state, repoPaths),
        options: step.state.options,
      });
    }
  });

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
      <Text color={colors['text-dim']}>SHARED TYPES</Text>
      {renderBody()}
      <ModalDialog title={SHARED_TYPES_QUIT_TITLE} open={quitConfirm}>
        <Text color={colors.text}>{SHARED_TYPES_QUIT_BODY}</Text>
        <Text color={colors['text-dim']}>Enter quit, Esc keep running</Text>
      </ModalDialog>
    </Box>
  );

  function renderBody() {
    if (run.status === 'blocked' && run.blocked !== null) {
      return (
        <Box flexDirection="column">
          <Text color={colors.error}>Blocked [{run.blocked.code}]: {run.blocked.message}</Text>
          <Text color={colors['text-dim']}>Enter/Esc back to the form</Text>
        </Box>
      );
    }
    if (run.status === 'running' || run.status === 'done') {
      return renderRun();
    }
    if (consumersStatus === 'loading' || consumersStatus === 'idle') {
      return <StateLine kind="loading" subject="consuming services" />;
    }
    if (consumersStatus === 'error') {
      return <StateLine kind="error" subject="consuming services" retry />;
    }
    if (consumers.length === 0) {
      return (
        <Box flexDirection="column">
          <StateLine kind="empty" subject="consuming services" text={SHARED_TYPES_NO_MEMBERS} />
          {renderIssues()}
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <TextInputLine label="Version" value={form.version.value} cursor={form.version.cursor} focused={form.row === 0} />
        <Text color={colors['text-dim']}>Services</Text>
        {consumers.map((consumer, index) => (
          <Box key={consumer.repoPath}>
            <Text color={form.row === index + 1 ? colors.accent : colors.text}>{form.row === index + 1 ? '> ' : '  '}</Text>
            <CheckboxListItem
              label={consumer.service}
              meta={`${consumer.dependency} on ${consumer.branch}`}
              state={form.unchecked.has(consumer.repoPath) ? 'unchecked' : 'checked'}
            />
          </Box>
        ))}
        <Text color={colors['text-dim']}>Options</Text>
        {OPTION_ROWS.map((option, index) => {
          const row = consumers.length + 1 + index;
          return (
            <Box key={option.key}>
              <Text color={form.row === row ? colors.accent : colors.text}>{form.row === row ? '> ' : '  '}</Text>
              <CheckboxListItem label={option.label} state={form.options[option.key] ? 'checked' : 'unchecked'} />
            </Box>
          );
        })}
        {renderIssues()}
      </Box>
    );
  }

  function renderIssues() {
    if (issues.length === 0) {
      return null;
    }
    return (
      <Box flexDirection="column">
        {issues.map((issue) => (
          <Text key={issue.repoPath} color={colors.warning}>
            {issue.service}: {issue.message}
          </Text>
        ))}
      </Box>
    );
  }

  function renderRun() {
    const chosen = consumers.filter((consumer) => {
      if (run.status === 'done') {
        return run.results.some((result) => result.repoPath === consumer.repoPath);
      }
      return !form.unchecked.has(consumer.repoPath);
    });
    return (
      <Box flexDirection="column">
        <Text color={colors.text}>Propagating {run.version}</Text>
        {chosen.map((consumer) => {
          const result = run.results.find((candidate) => candidate.repoPath === consumer.repoPath);
          const index = run.results.findIndex((candidate) => candidate.repoPath === consumer.repoPath);
          const live = run.live?.repoPath === consumer.repoPath ? run.live : null;
          const focused = run.status === 'done' && index === resultRow;
          const color = result === undefined ? colors['text-dim'] : result.outcome === 'done' ? colors.success : result.outcome === 'skipped' ? colors.warning : colors.error;
          return (
            <Box key={consumer.repoPath}>
              <Text color={focused ? colors.accent : colors.text}>{focused ? '> ' : '  '}</Text>
              {live !== null && run.status === 'running' ? <Spinner /> : null}
              <Text color={color}>
                {' '}
                {consumer.service}:{' '}
                {result !== undefined
                  ? summarizeResult(result)
                  : live !== null
                    ? STEP_LABELS[live.step]
                    : run.status === 'running'
                      ? 'waiting'
                      : ''}
              </Text>
            </Box>
          );
        })}
        {run.status === 'done' ? (
          <Text color={colors['text-dim']}>
            {run.results.some((result) => result.outcome === 'failed')
              ? 'Up/Down select, R retry the failed service, Esc new run'
              : 'Esc new run'}
          </Text>
        ) : null}
      </Box>
    );
  }
}
