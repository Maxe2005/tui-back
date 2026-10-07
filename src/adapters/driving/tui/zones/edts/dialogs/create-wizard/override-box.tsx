// tui/zones/edts/dialogs/create-wizard: the "Configure <service>" override box's Ink view. Its
// state, key reducer and Apply validation live in override-box.logic.ts.
import { Box, Text } from 'ink';
import {
  BranchAutocompleteInput,
  type BranchAutocompleteState,
} from '../../../../shared/components/branch-autocomplete-input.js';
import type { TextInputState } from '../../../../shared/components/text-edit.js';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { colors } from '../../../../shared/theme/theme.js';
import { isProtectedTarget } from './wizard.logic.js';
import {
  overrideBoxBranches,
  protectedNameError,
  type OverrideBoxContext,
  type OverrideBoxLine,
  type OverrideBoxState,
} from './override-box.logic.js';
import { formatHints } from '../../../../shared/components/hints.js';

function LineMarker({ focused }: { focused: boolean }) {
  return <Text color={colors.accent}>{focused ? '› ' : '  '}</Text>;
}

function BoxField({
  label,
  focused,
  editing,
  autocomplete,
  value,
  context,
  maxRows,
}: {
  label: string;
  focused: boolean;
  editing: boolean;
  autocomplete?: BranchAutocompleteState;
  value: TextInputState;
  context: OverrideBoxContext;
  maxRows: number;
}) {
  if (focused && editing && autocomplete !== undefined) {
    const status = context.status === 'ready' ? 'ready' : context.status === 'error' ? 'error' : 'loading';
    return (
      <Box>
        <LineMarker focused={true} />
        <BranchAutocompleteInput
          label={label}
          state={autocomplete}
          branches={overrideBoxBranches(context)}
          branchesStatus={status}
          maxRows={maxRows}
          focused={true}
        />
      </Box>
    );
  }
  return (
    <Box>
      <LineMarker focused={focused} />
      <TextInputLine label={label} value={value.value} cursor={value.cursor} focused={focused && editing} />
    </Box>
  );
}

export const OVERRIDE_BOX_FOOTER =
  formatHints([['↑/↓/Tab', 'move'], ['Enter', 'edit / apply'], ['Space/←/→', 'mode'], ['Ctrl+R', 'back to global strategy'], ['Esc', 'close']]);

export function OverrideBoxView({
  box,
  context,
  maxRows,
}: {
  box: OverrideBoxState;
  // Its `service` is the single source for the title and every inline protected message.
  context: OverrideBoxContext;
  maxRows: number;
}) {
  const focused = (line: OverrideBoxLine) => box.line === line;
  const nameProtected = box.mode === 'create' && box.name.value.trim() !== '' && isProtectedTarget(box.name.value, context);
  const newNameProtected = box.mode === 'existing' && box.rename && box.newName.value.trim() !== '' && isProtectedTarget(box.newName.value, context);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold>
        Configure {context.service}
      </Text>
      <Box>
        <LineMarker focused={focused('mode')} />
        <Text color={focused('mode') ? colors.accent : colors.text}>
          Mode: {box.mode === 'create' ? '(•)' : '( )'} Create new {box.mode === 'existing' ? '(•)' : '( )'} Choose existing
        </Text>
      </Box>
      {box.mode === 'create' ? (
        <>
          <BoxField
            label="Base branch (source)"
            focused={focused('base')}
            editing={box.editing}
            autocomplete={box.base}
            value={box.base}
            context={context}
            maxRows={maxRows}
          />
          <BoxField label="Branch name" focused={focused('name')} editing={box.editing} value={box.name} context={context} maxRows={maxRows} />
          {nameProtected ? <Text color={colors.error}>✖ {protectedNameError(box.name.value.trim(), context.service)}</Text> : null}
        </>
      ) : (
        <>
          <BoxField
            label="Existing branch"
            focused={focused('existing')}
            editing={box.editing}
            autocomplete={box.existing}
            value={box.existing}
            context={context}
            maxRows={maxRows}
          />
          <Box>
            <LineMarker focused={focused('rename')} />
            <Text color={focused('rename') ? colors.accent : colors.text}>{box.rename ? '[x]' : '[ ]'} Rename the local branch</Text>
          </Box>
          {box.rename ? (
            <BoxField label="New name" focused={focused('newName')} editing={box.editing} value={box.newName} context={context} maxRows={maxRows} />
          ) : null}
          {newNameProtected ? <Text color={colors.error}>✖ {protectedNameError(box.newName.value.trim(), context.service)}</Text> : null}
        </>
      )}
      <Box>
        <LineMarker focused={focused('apply')} />
        <Text color={focused('apply') ? colors.accent : colors.text} bold={focused('apply')}>
          [ Apply ]
        </Text>
      </Box>
      {box.error !== null ? <Text color={colors.error}>✖ {box.error}</Text> : null}
      <Text color={colors['text-dim']}>{OVERRIDE_BOX_FOOTER}</Text>
    </Box>
  );
}
