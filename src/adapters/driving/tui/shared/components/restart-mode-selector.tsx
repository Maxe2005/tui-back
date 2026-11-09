// tui/shared/components: the post-action restart selector — a radio over the restart modes (none /
// simple / clean by default) shared by the switch, realign and heal dialogs. It only renders the
// choice; the owning dialog changes it for its own run and never writes it back to the settings.
import { Box, Text } from 'ink';
import type { SwitchRestartMode } from '../../../../../core/ports/settings.js';
import { colors } from '../theme/theme.js';
import { DimAnnotation } from './dim-annotation.js';

export const RESTART_MODE_ORDER: readonly SwitchRestartMode[] = ['none', 'simple', 'clean'];

export const RESTART_MODE_LABELS: Record<SwitchRestartMode, string> = {
  none: 'Aucun',
  simple: 'Redémarrage simple',
  clean: 'Clean restart',
};

export const RESTART_MODE_RECIPE_HINT = "Le clean restart retombe sur un redémarrage simple là où aucune recette n'existe.";

export function RestartModeSelector({
  mode,
  title = 'Redémarrer les services après le switch',
  keysHint = '←/→ ou Espace pour changer.',
  modes = RESTART_MODE_ORDER,
}: {
  mode: SwitchRestartMode;
  title?: string;
  // The keys the owning dialog binds to the selector.
  keysHint?: string;
  // The choices offered, in order (heal has no `none`).
  modes?: readonly SwitchRestartMode[];
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={colors.text} wrap="truncate-end">{title}</Text>
      <Text wrap="truncate-end">
        {modes.map((value) => (
          <Text key={value} color={value === mode ? colors.accent : colors['text-dim']}>
            {value === mode ? '(•)' : '( )'} {RESTART_MODE_LABELS[value]}
            {'   '}
          </Text>
        ))}
      </Text>
      <DimAnnotation text={`${keysHint} ${RESTART_MODE_RECIPE_HINT}`} />
    </Box>
  );
}
