// tui/zones/edts/dialogs/create-wizard: Step 4 "Activation". Below a read-only recap (built from
// Step 3's row views, so it shows exactly what the submit sends): the locked activation option
// for a first EDT, else the switch-now / create-without-switching radio with its info block; once
// created, the pause panel, the overwrite confirmation, or the "created but not active" message.
// Key handling lives in activation.logic.ts.
import { Box, Text } from 'ink';
import { ClampedParagraph } from '../../../../shared/components/truncated-text.js';
import { BoundedList } from '../../../../shared/components/bounded-list.js';
import { colors } from '../../../../shared/theme/theme.js';
import type { CreateDialogState } from '../../edts-zone.logic.js';
import {
  overwriteConfirmLines,
} from './activation.logic.js';
import { ACTIVATION_LABELS, activateLaterHint, buildStep3Rows, nonMemberReturns, type BranchCandidate, type RowView } from './wizard.logic.js';
// The branch part of a recap line: `base → target`, except a rename (its target already reads
// `-> new`) and an [Existante] row attached under its own name, printed once.
export function recapBranches(row: RowView): string {
  if (row.mode === 'rename') {
    return `${row.base} ${row.target}`;
  }
  if (row.mode === 'existing' && row.base === row.target) {
    return row.base;
  }
  return `${row.base} → ${row.target}`;
}

function Recap({ dialog, candidates }: { dialog: CreateDialogState; candidates: readonly BranchCandidate[] }) {
  const rows = buildStep3Rows(dialog, candidates);
  return (
    <>
      <Text color={colors.text} wrap="truncate-end">Name: {dialog.topic.trim()}</Text>
      <Text color={colors.text} wrap="truncate-end">Services: {rows.map((row) => row.service).join(', ')}</Text>
      {rows.map((row) => (
        <Text key={row.path} color={colors['text-dim']} wrap="truncate-end">
          {'  '}
          {row.service} : {row.modeLabel} {recapBranches(row)}
        </Text>
      ))}
    </>
  );
}

function PausePanel({ dialog, maxVisibleRows }: { dialog: CreateDialogState; maxVisibleRows: number }) {
  const lines = overwriteConfirmLines(dialog.activation.blocked ?? []);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.warning} paddingX={1}>
      <Text color={colors.warning} bold>
        ACTIVATION PAUSED
      </Text>
      <Text color={colors.text}>
        The EDT is created. These uncommitted files would be overwritten by the move to the target branch — no switch has happened yet:
      </Text>
      <BoundedList
        items={lines}
        maxVisibleRows={maxVisibleRows}
        moreBelowLabel="files below"
        renderItem={(line) => (
          <Text key={line.key} color={line.kind === 'head' ? colors.warning : colors.text} wrap="truncate-end">
            {line.text}
          </Text>
        )}
      />
    </Box>
  );
}

function OverwriteConfirm({ dialog, maxVisibleRows }: { dialog: CreateDialogState; maxVisibleRows: number }) {
  const lines = overwriteConfirmLines(dialog.activation.blocked ?? []);
  const cursor = Math.min(dialog.activation.confirm?.scroll ?? 0, Math.max(lines.length - 1, 0));
  return (
    <Box flexDirection="column">
      <Text color={colors.error} bold>
        CONFIRM OVERWRITE
      </Text>
      <Text color={colors.text}>
        Uncommitted changes in these files (tracked, staged or untracked) will be permanently destroyed, then activation resumes. This cannot be undone.
      </Text>
      <BoundedList
        items={lines}
        maxVisibleRows={maxVisibleRows}
        cursorIndex={cursor}
        moreAboveLabel="files above"
        moreBelowLabel="files below"
        renderItem={(line) => (
          <Text key={line.key} color={line.kind === 'head' ? colors.warning : colors.text} wrap="truncate-end">
            {line.text}
          </Text>
        )}
      />
    </Box>
  );
}

function ChoiceView({ dialog, candidates }: { dialog: CreateDialogState; candidates: readonly BranchCandidate[] }) {
  const { activation } = dialog;
  if (activation.firstEdt) {
    return (
      <>
        <Text color={colors.accent} wrap="truncate-end">(•) {ACTIVATION_LABELS.firstEdt} — Yes (locked)</Text>
        <ClampedParagraph color={colors['text-dim']} maxLines={3}>{'    ' + ACTIVATION_LABELS.firstEdtExplanation}</ClampedParagraph>
      </>
    );
  }
  const switching = activation.choice === 'switch';
  const returns = nonMemberReturns(candidates, dialog.selectedMembers);
  const info = colors['text-dim'];
  return (
    <>
      <Text color={switching ? colors.accent : colors.text} wrap="truncate-end">
        {switching ? '(•)' : '( )'} {ACTIVATION_LABELS.switchNow}
      </Text>
      <Box flexDirection="column" paddingLeft={4}>
        <ClampedParagraph color={info} dimColor={!switching} maxLines={3}>{`• ${ACTIVATION_LABELS.stashInfo}`}</ClampedParagraph>
        <ClampedParagraph color={info} dimColor={!switching} maxLines={3}>{`• ${ACTIVATION_LABELS.otherDirtyInfo}`}</ClampedParagraph>
        <ClampedParagraph color={info} dimColor={!switching} maxLines={3}>{`• ${ACTIVATION_LABELS.membersInfo}`}</ClampedParagraph>
        {returns.length > 0 ? (
          <>
            <ClampedParagraph color={info} dimColor={!switching} maxLines={3}>{`• ${ACTIVATION_LABELS.nonMembersInfo}`}</ClampedParagraph>
            {returns.map((entry) => (
              <Text key={entry.service} color={info} dimColor={!switching} wrap="truncate-end">
                {'    '}
                {entry.service} → {entry.sharedBranch}
              </Text>
            ))}
          </>
        ) : null}
      </Box>
      <Text color={switching ? colors.text : colors.accent} wrap="truncate-end">
        {switching ? '( )' : '(•)'} {ACTIVATION_LABELS.stay}
      </Text>
    </>
  );
}

export function ActivationStepView({
  dialog,
  candidates,
  maxVisibleRows,
}: {
  dialog: CreateDialogState;
  candidates: readonly BranchCandidate[];
  // The pause panel / overwrite confirmation file-list height budget (NFR-7).
  maxVisibleRows: number;
}) {
  const { activation } = dialog;
  let body = null;
  if (activation.outcome !== null) {
    body = (
      <>
        <Text color={colors.warning} wrap="truncate-end">{activation.outcome === 'stopped' ? ACTIVATION_LABELS.stopped : ACTIVATION_LABELS.notActivated}</Text>
        <Text color={colors['text-dim']} wrap="truncate-end">{activateLaterHint(activation.created?.topic ?? dialog.topic)}</Text>
      </>
    );
  } else if (activation.confirm !== null) {
    body = <OverwriteConfirm dialog={dialog} maxVisibleRows={maxVisibleRows} />;
  } else if (activation.blocked !== null) {
    body = <PausePanel dialog={dialog} maxVisibleRows={maxVisibleRows} />;
  } else if (activation.created === null) {
    body = <ChoiceView dialog={dialog} candidates={candidates} />;
  }
  return (
    <Box flexDirection="column">
      {activation.confirm === null ? <Recap dialog={dialog} candidates={candidates} /> : null}
      {body}
    </Box>
  );
}
