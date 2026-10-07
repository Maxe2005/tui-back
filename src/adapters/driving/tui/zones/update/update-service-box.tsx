// tui/zones/update: render-only view of the "Configure <service>" box (state and keys live in
// update-service-box.logic.ts). Height: SERVICE_BOX_ROWS (update-config-panels.logic.ts)
// + the branch field's list (`dropdownLines`); every line is truncated, none can wrap.
import { Box, Text } from 'ink';
import { BranchAutocompleteInput } from '../../shared/components/branch-autocomplete-input.js';
import { colors } from '../../shared/theme/theme.js';
import type { ToggleOverride } from './update-config-dialog.logic.js';
import { toggleOptions, type ServiceBoxContext, type ServiceBoxLine, type ServiceBoxState } from './update-service-box.logic.js';

export const SHARED_BRANCH_PLACEHOLDER = '<shared-branch>';

const OPTION_LABEL: Record<ToggleOverride, (global: boolean) => string> = {
  follow: (global) => `follow global (${global ? 'yes' : 'no'})`,
  off: () => 'no',
  on: () => 'yes',
};

function Marker({ focused }: { focused: boolean }) {
  return <Text color={colors.accent}>{focused ? '› ' : '  '}</Text>;
}

function ToggleLine({
  label,
  focused,
  value,
  declared,
  global,
  undeclaredText,
}: {
  label: string;
  focused: boolean;
  value: ToggleOverride;
  declared: boolean;
  global: boolean;
  undeclaredText: string;
}) {
  return (
    <Box>
      <Marker focused={focused} />
      <Text color={focused ? colors.accent : colors.text}>{label.padEnd(16)}</Text>
      {declared ? (
        <Text color={focused ? colors.accent : colors.text} wrap="truncate-end">
          {toggleOptions(declared)
            .map((option) => `${option === value ? '(•)' : '( )'} ${OPTION_LABEL[option](global)}`)
            .join('  ')}
        </Text>
      ) : (
        <Text color={colors['text-dim']} wrap="truncate-end">{undeclaredText}</Text>
      )}
    </Box>
  );
}

export function UpdateServiceBox({
  box,
  context,
  globalMigrations,
  globalCleanRestart,
  dropdownLines,
}: {
  box: ServiceBoxState;
  context: ServiceBoxContext;
  globalMigrations: boolean;
  globalCleanRestart: boolean;
  dropdownLines: number;
}) {
  const focused = (line: ServiceBoxLine) => box.line === line;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold wrap="truncate-end">
        Configure {context.service}
      </Text>
      <Box>
        <Marker focused={focused('branch')} />
        <BranchAutocompleteInput
          label="Source branch"
          labelWidth={16}
          state={box.branch}
          branches={context.branches}
          placeholder={SHARED_BRANCH_PLACEHOLDER}
          branchesStatus={context.branchesStatus}
          maxLines={dropdownLines}
          editing={box.editing}
          focused={focused('branch')}
        />
      </Box>
      <ToggleLine
        label="Migrations"
        focused={focused('migrations')}
        value={box.migrations}
        declared={context.migrationDeclared}
        global={globalMigrations}
        undeclaredText="— no command declared"
      />
      <ToggleLine
        label="Clean restart"
        focused={focused('restart')}
        value={box.cleanRestart}
        declared={context.recipeDeclared}
        global={globalCleanRestart}
        undeclaredText="— no recipe: basic restart"
      />
      <Box>
        <Marker focused={focused('apply')} />
        <Text color={focused('apply') ? colors.accent : colors.text} bold={focused('apply')}>
          [ Apply ]
        </Text>
      </Box>
      {box.error !== null ? (
        <Text color={colors.error} wrap="truncate-end">
          ✖ {box.error}
        </Text>
      ) : null}
    </Box>
  );
}
