// tui/zones/update: render-only view of the "Configurer <service>" box (state and keys live in
// update-service-box.logic.ts). Height: border 2 + title 1 + branch field 1 + its list
// (`dropdownLines`) + 2 toggle lines + apply 1 + error 1 + footer 1 = 9 + dropdownLines.
import { Box, Text } from 'ink';
import { SuggestField } from '../../shared/components/suggest-field.js';
import { colors } from '../../shared/theme/theme.js';
import type { ToggleOverride } from './update-config-dialog.logic.js';
import { toggleOptions, type ServiceBoxContext, type ServiceBoxLine, type ServiceBoxState } from './update-service-box.logic.js';

export const SERVICE_BOX_BOX_ROWS = 9;
export const SERVICE_BOX_FOOTER = '[↑/↓] Ligne • [Entrée] Éditer / Valider • [Espace] Changer • [Ctrl+R] Revenir au global • [Esc] Fermer';
export const SHARED_BRANCH_PLACEHOLDER = '<shared-branch>';

const OPTION_LABEL: Record<ToggleOverride, (global: boolean) => string> = {
  follow: (global) => `suivre global (${global ? 'oui' : 'non'})`,
  off: () => 'non',
  on: () => 'oui',
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
        Configurer {context.service}
      </Text>
      <Box>
        <Marker focused={focused('branch')} />
        <SuggestField
          label="Branche source"
          labelWidth={16}
          state={box.branch}
          suggestions={context.branches}
          placeholder={SHARED_BRANCH_PLACEHOLDER}
          status={context.branchesStatus}
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
        undeclaredText="— aucune commande déclarée"
      />
      <ToggleLine
        label="Clean restart"
        focused={focused('restart')}
        value={box.cleanRestart}
        declared={context.recipeDeclared}
        global={globalCleanRestart}
        undeclaredText="— aucune recette : restart basique"
      />
      <Box>
        <Marker focused={focused('apply')} />
        <Text color={focused('apply') ? colors.accent : colors.text} bold={focused('apply')}>
          [ Appliquer ]
        </Text>
      </Box>
      {box.error !== null ? (
        <Text color={colors.error} wrap="truncate-end">
          ✖ {box.error}
        </Text>
      ) : null}
      <Text color={colors['text-dim']} wrap="truncate-end">
        {SERVICE_BOX_FOOTER}
      </Text>
    </Box>
  );
}
