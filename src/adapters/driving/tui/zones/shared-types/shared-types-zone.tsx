// tui/zones/shared-types: propagate a version of the shared dependency to the active EDT's
// consuming services. A `disabled` tab shows its explanatory message; otherwise the zone is the
// form (version field pre-filled `0.1.`, consumer checklist, option toggles), then the run view
// (live step with spinner), then per-service results with independent retry. `q` mid-run asks
// for confirmation. The use-cases live in core; this file renders and dispatches keys.
import { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import { SHARED_TYPES_MODULE_IDS } from '../../../../../core/edt/resolve-tab-visibility.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { CheckboxListItem, ModalDialog, Spinner, StateLine, TextInputLine } from '../../shared/components/index.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { ClampedParagraph, TruncatedText } from '../../shared/components/truncated-text.js';
import { useInput } from '../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../shared/hooks/use-zone-input-active.js';
import { useFooterContext } from '../../shared/hooks/use-footer-context.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  OPTION_ROWS,
  STEP_LABELS,
  initialFormState,
  reduceForm,
  resolvePublishBlockedKey,
  resolvePublishDoneKey,
  resolveQuitDecision,
  selectedRepoPaths,
  shouldConfirmQuit,
  shouldStartPublish,
  summarizeResult,
  type FormState,
} from './shared-types-zone.logic.js';

// The singular-carrier phrasing names the source id specifically; the plural phrasing (module
// identity ambiguous across several carriers) names both ids generically instead.
const [SOURCE_MODULE_ID] = SHARED_TYPES_MODULE_IDS;

export const SHARED_TYPES_QUIT_TITLE = 'QUIT MID-RUN';
export const SHARED_TYPES_QUIT_BODY = 'A version propagation is in progress. Quit anyway? Services already processed stay as they are.';
export const SHARED_TYPES_PUBLISH_QUIT_BODY = 'A version publish is in progress. Quit anyway?';
export const SHARED_TYPES_NO_MEMBERS = 'No service of the active EDT consumes the shared dependency — nothing to propagate.';
export const SHARED_TYPES_PUBLISH_TITLE = 'PUBLISH';
export const SHARED_TYPES_CHAIN_HINT = 'C chain into propagation with this version, Esc stop';

// Rows the form/run views use around their windowed consumer list: title, version row, two
// section headers, the option rows, the issue lines, the run notice and hint.
const FORM_CHROME_ROWS = 4 + OPTION_ROWS.length + 4;
const RUN_CHROME_ROWS = 6;
const MAX_ISSUE_ROWS = 3;
const MAX_CLAMPED_LINES = 4;

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
        <ClampedParagraph color={colors.text} maxLines={MAX_CLAMPED_LINES}>{formatSharedTypesDisabledMessage(carryingServices)}</ClampedParagraph>
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
  const sources = useStore((state) => state.sharedTypesSources);
  const sourcesStatus = useStore((state) => state.sharedTypesSourcesStatus);
  const sourcesError = useStore((state) => state.sharedTypesSourcesError);
  const publish = useStore((state) => state.sharedTypesPublish);
  const loadSource = useStore((state) => state.loadSharedTypesSource);
  const runPublish = useStore((state) => state.runSharedTypesPublish);
  const retryPublish = useStore((state) => state.retrySharedTypesPublish);
  const resetPublish = useStore((state) => state.resetSharedTypesPublish);
  const requestQuit = useStore((state) => state.requestQuit);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const activeEdt = useStore((state) => state.activeEdt);

  const settingsOptions = useStore((state) => state.settings.sharedTypes);
  const [form, setForm] = useState<FormState>(() => initialFormState(settingsOptions));
  // A change of the saved defaults (`:settings` st tab) re-seeds the toggles; ticking one in the
  // zone stays local to the form and never writes back.
  useEffect(() => {
    setForm((previous) => ({ ...previous, options: { install: settingsOptions.install, cleanRestart: settingsOptions.cleanRestart, commit: settingsOptions.commit } }));
  }, [settingsOptions.install, settingsOptions.cleanRestart, settingsOptions.commit]);
  const [resultRow, setResultRow] = useState(0);
  const [quitConfirm, setQuitConfirm] = useState(false);

  useEffect(() => {
    void loadConsumers();
  }, [loadConsumers, activeEdt]);
  useEffect(() => {
    void loadSource();
  }, [loadSource, activeEdt]);

  const repoPaths = consumers.map((consumer) => consumer.repoPath);
  const repoPathsKey = repoPaths.join('\n');

  // A new consumer list (or another EDT) starts the checklist afresh; the typed version stays.
  useEffect(() => {
    setForm((previous) => ({ ...previous, unchecked: new Set(), row: 0, editing: false }));
    setResultRow(0);
  }, [repoPathsKey, activeEdt]);
  const onVersionField = run.status === 'idle' && consumersStatus === 'ready' && consumers.length > 0 && form.row === 0 && form.editing;
  const onVersionRow = run.status === 'idle' && consumersStatus === 'ready' && consumers.length > 0 && form.row === 0;

  // The version field types freely (letters included), and a quit confirmation owns the keys.
  useEffect(() => {
    setZoneInputCaptured(quitConfirm || onVersionField);
    return () => setZoneInputCaptured(false);
  }, [quitConfirm, onVersionField, setZoneInputCaptured]);

  useFooterContext(
    'shared-types',
    quitConfirm
      ? 'confirm'
      : run.status === 'running' || publish.status === 'running'
        ? 'busy'
        : publish.status === 'blocked'
          ? 'shared-types-publish-failed'
          : publish.status === 'done'
            ? 'shared-types-publish-done'
            : run.status === 'done'
              ? 'shared-types-results'
              : run.status === 'idle' && consumersStatus === 'ready' && consumers.length > 0
                ? onVersionField
                  ? 'shared-types-version'
                  : onVersionRow
                    ? 'shared-types-version-row'
                    : 'shared-types-form'
                : null,
    useStore,
  );

  const publishQuitBody = publish.status === 'running' ? SHARED_TYPES_PUBLISH_QUIT_BODY : SHARED_TYPES_QUIT_BODY;
  const zoneInputActive = useZoneInputActive(useStore);

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
    if (shouldConfirmQuit(input, run.status, publish.status)) {
      setQuitConfirm(true);
      return;
    }
    if (publish.status === 'running' || run.status === 'running') {
      return;
    }
    if (publish.status === 'blocked' && !form.editing) {
      const decision = resolvePublishBlockedKey(input, key);
      if (decision === 'relaunch') {
        void retryPublish();
      } else if (decision === 'back') {
        resetPublish();
      }
      return;
    }
    if (publish.status === 'done' && publish.version !== null && !form.editing) {
      const decision = resolvePublishDoneKey(input, key);
      if (decision === 'chain') {
        const version = publish.version;
        resetPublish();
        setForm((previous) => ({ ...previous, version: { value: version, cursor: version.length }, row: 0, editing: false }));
      } else if (decision === 'stop') {
        resetPublish();
      }
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
        setResultRow((row) => Math.max(0, Math.min(run.results.length - 1, row + 1)));
      } else if ((input === 'r' || input === 'R') && run.results[resultRow]?.outcome === 'failed') {
        void retryService(run.results[resultRow]!.repoPath);
      } else if (key.escape === true || input === 'n') {
        setResultRow(0);
        resetRun();
      }
      return;
    }
    if (sourcesStatus === 'error' && (input === 'R' || input === 'r')) {
      void loadSource();
      if (consumersStatus === 'error') {
        void loadConsumers();
      }
      return;
    }
    if (consumersStatus === 'error' && (input === 'R' || input === 'r')) {
      void loadConsumers();
      return;
    }
    if (!form.editing && run.status === 'idle' && shouldStartPublish(input, publish.status, sources.length, sourcesStatus)) {
      void runPublish();
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
  }, { isActive: zoneInputActive });

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface} paddingX={spacing['pane-padding-x']}>
      <Text color={colors['text-dim']}>SHARED TYPES</Text>
      {renderPublish()}
      {renderBody()}
      <ModalDialog title={SHARED_TYPES_QUIT_TITLE} open={quitConfirm}>
        <ClampedParagraph color={colors.text} maxLines={MAX_CLAMPED_LINES}>{publishQuitBody}</ClampedParagraph>
        <Text color={colors['text-dim']} wrap="truncate-end">Enter quit, Esc keep running</Text>
      </ModalDialog>
    </Box>
  );

  function renderPublish() {
    if (sourcesStatus === 'loading') {
      return <StateLine kind="loading" subject="source repo" />;
    }
    if (sourcesStatus === 'error') {
      return (
        <Box flexDirection="column">
          <ClampedParagraph color={colors.error} maxLines={MAX_CLAMPED_LINES}>
            {sourcesError !== null ? `[${sourcesError.code}] ${sourcesError.message}` : 'Source repo unavailable.'}
          </ClampedParagraph>
          <Text color={colors['text-dim']} wrap="truncate-end">R reload</Text>
        </Box>
      );
    }
    if (sourcesStatus !== 'ready' || sources.length !== 1) {
      if (publish.notice) {
        return (
          <Box flexDirection="column">
            <ClampedParagraph color={colors.warning} maxLines={2}>{publish.notice}</ClampedParagraph>
          </Box>
        );
      }
      return null;
    }
    const source = sources[0]!;
    if (publish.status === 'running') {
      return (
        <Box flexDirection="column">
          <Box>
            <Spinner />
            <TruncatedText color={colors.text}>{` Publishing ${source.service}…`}</TruncatedText>
          </Box>
        </Box>
      );
    }
    if (publish.status === 'blocked' && publish.error !== null) {
      return (
        <Box flexDirection="column">
          <Text color={colors['text-dim']} wrap="truncate-end">{SHARED_TYPES_PUBLISH_TITLE}</Text>
          <ClampedParagraph color={colors.error} maxLines={MAX_CLAMPED_LINES}>{`Publish failed [${publish.error.code}]: ${publish.error.message}`}</ClampedParagraph>
          {publish.output ? <TruncatedText color={colors['text-dim']}>{publish.output}</TruncatedText> : null}
          {publish.notice ? <ClampedParagraph color={colors.warning} maxLines={2}>{publish.notice}</ClampedParagraph> : null}
          <Text color={colors['text-dim']} wrap="truncate-end">R relaunch the whole command, Esc back</Text>
        </Box>
      );
    }
    if (publish.status === 'done' && publish.version !== null) {
      return (
        <Box flexDirection="column">
          <Text color={colors['text-dim']} wrap="truncate-end">{SHARED_TYPES_PUBLISH_TITLE}</Text>
          <TruncatedText color={colors.success}>{`Published ${publish.version}`}</TruncatedText>
          {publish.output ? <TruncatedText color={colors['text-dim']}>{publish.output}</TruncatedText> : null}
          {publish.notice ? <ClampedParagraph color={colors.warning} maxLines={2}>{publish.notice}</ClampedParagraph> : null}
          <Text color={colors['text-dim']} wrap="truncate-end">{SHARED_TYPES_CHAIN_HINT}</Text>
        </Box>
      );
    }
    return (
      <Box flexDirection="column">
        <Text color={colors['text-dim']} wrap="truncate-end">{`${SHARED_TYPES_PUBLISH_TITLE}: ${source.service} (P publish)`}</Text>
        {publish.notice ? <ClampedParagraph color={colors.warning} maxLines={2}>{publish.notice}</ClampedParagraph> : null}
      </Box>
    );
  }

  function renderBody() {
    if (run.status === 'blocked' && run.blocked !== null) {
      return (
        <Box flexDirection="column">
          <ClampedParagraph color={colors.error} maxLines={MAX_CLAMPED_LINES}>{`Blocked [${run.blocked.code}]: ${run.blocked.message}`}</ClampedParagraph>
          <Text color={colors['text-dim']} wrap="truncate-end">Enter/Esc back to the form</Text>
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
      return (
        <Box flexDirection="column">
          <StateLine kind="error" subject="consuming services" retry />
          {consumersError !== null ? (
            <ClampedParagraph color={colors.error} maxLines={MAX_CLAMPED_LINES}>{`[${consumersError.code}] ${consumersError.message}`}</ClampedParagraph>
          ) : null}
        </Box>
      );
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
        <Box>
          <Text color={form.row === 0 ? colors.accent : colors.text} wrap="truncate-end">{form.row === 0 ? '> ' : '  '}</Text>
          <TextInputLine
            label="Version"
            value={form.version.value}
            cursor={form.version.cursor}
            focused={form.row === 0 && form.editing}
            highlighted={form.row === 0}
          />
        </Box>
        <Text color={colors['text-dim']}>Services</Text>
        <BoundedList
          items={consumers}
          chromeRows={FORM_CHROME_ROWS}
          cursorIndex={form.row >= 1 && form.row <= consumers.length ? form.row - 1 : undefined}
          renderItem={(consumer, index) => (
            <Box key={consumer.repoPath}>
              <Text color={form.row === index + 1 ? colors.accent : colors.text} wrap="truncate-end">{form.row === index + 1 ? '> ' : '  '}</Text>
              <CheckboxListItem
                label={consumer.service}
                meta={`${consumer.dependency} on ${consumer.branch}`}
                state={form.unchecked.has(consumer.repoPath) ? 'unchecked' : 'checked'}
              />
            </Box>
          )}
        />
        <Text color={colors['text-dim']}>Options</Text>
        {OPTION_ROWS.map((option, index) => {
          const row = consumers.length + 1 + index;
          return (
            <Box key={option.key}>
              <Text color={form.row === row ? colors.accent : colors.text} wrap="truncate-end">{form.row === row ? '> ' : '  '}</Text>
              <CheckboxListItem label={option.label} state={form.options[option.key] ? 'checked' : 'unchecked'} />
            </Box>
          );
        })}
        {renderIssues()}
        {run.notice ? <ClampedParagraph color={colors.warning} maxLines={2}>{run.notice}</ClampedParagraph> : null}
      </Box>
    );
  }

  function renderIssues() {
    if (issues.length === 0) {
      return null;
    }
    return (
      <Box flexDirection="column">
        <BoundedList
          items={issues}
          maxVisibleRows={MAX_ISSUE_ROWS + 1}
          moreBelowLabel="more issues"
          renderItem={(issue) => (
            <TruncatedText key={issue.repoPath} color={colors.warning}>
              {`${issue.service}: ${issue.message}`}
            </TruncatedText>
          )}
        />
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
        <TruncatedText color={colors.text}>{`Propagating ${run.version}`}</TruncatedText>
        <BoundedList
          items={chosen}
          chromeRows={RUN_CHROME_ROWS}
          cursorIndex={run.status === 'done' ? Math.max(0, chosen.findIndex((consumer) => run.results[resultRow]?.repoPath === consumer.repoPath)) : undefined}
          renderItem={(consumer) => {
            const result = run.results.find((candidate) => candidate.repoPath === consumer.repoPath);
            const index = run.results.findIndex((candidate) => candidate.repoPath === consumer.repoPath);
            const live = run.live?.repoPath === consumer.repoPath ? run.live : null;
            const focused = run.status === 'done' && index === resultRow;
            const color = result === undefined ? colors['text-dim'] : result.outcome === 'done' ? colors.success : result.outcome === 'skipped' ? colors.warning : colors.error;
            return (
              <Box key={consumer.repoPath}>
                <Text color={focused ? colors.accent : colors.text} wrap="truncate-end">{focused ? '> ' : '  '}</Text>
                {live !== null && run.status === 'running' ? <Spinner /> : null}
                <TruncatedText color={color}>
                  {` ${consumer.service}: ${
                    result !== undefined
                      ? summarizeResult(result)
                      : live !== null
                        ? STEP_LABELS[live.step]
                        : run.status === 'running'
                          ? 'waiting'
                          : ''
                  }`}
                </TruncatedText>
              </Box>
            );
          }}
        />
        {run.status === 'done' && run.notice ? <ClampedParagraph color={colors.warning} maxLines={2}>{run.notice}</ClampedParagraph> : null}
        {run.status === 'done' ? (
          <Text color={colors['text-dim']} wrap="truncate-end">
            {run.results.some((result) => result.outcome === 'failed')
              ? 'Up/Down select, R retry the failed service, Esc new run'
              : 'Esc new run'}
          </Text>
        ) : null}
      </Box>
    );
  }
}
