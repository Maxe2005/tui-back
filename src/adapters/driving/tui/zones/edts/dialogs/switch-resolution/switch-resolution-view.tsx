// tui/zones/edts/dialogs/switch-resolution: Story 2.41 — the SWITCH EDT resolution view's Ink
// rendering: the intro, Panel A (global strategy), Panel B (the shared BranchPlanTable, then the
// read-only dim state-1 rows), the "Configurer <service>" box and the discard confirmation. Its
// state and key handling live in switch-resolution.logic.ts.
import { Box, Text } from 'ink';
import type { SwitchDirtyRepo } from '../../../../../../../core/edt/switch.js';
import { BoundedList } from '../../../../shared/components/bounded-list.js';
import { TextInputLine } from '../../../../shared/components/text-input-line.js';
import { colors } from '../../../../shared/theme/theme.js';
import { BranchPlanTable, PanelTitle, type BranchPlanCell } from '../branch-plan-table.js';
import {
  autoStashedRepos,
  blockedRow,
  boxError,
  buildRows,
  globalOf,
  modeLabel,
  scopeLabel,
  SWITCH_RESOLUTION_FOOTER,
  validateRow,
  type LocalBranchList,
  type ResolutionRow,
  type SwitchResolutionBox,
  type SwitchResolutionState,
} from './switch-resolution.logic.js';

const COLUMN_HEADERS = ['Service', 'Portée', 'Branche actuelle', 'Action', 'Branche cible'] as const;

export const RESOLUTION_BOX_FOOTER = '[↑/↓] Ligne • [Espace] Action • [Entrée] Éditer / Appliquer • [Ctrl+R] Revenir à la stratégie globale • [Esc] Fermer';
export const DISCARD_CONFIRM_FOOTER = '[Ctrl+E] Écraser définitivement • [Entrée] / [Esc] Retour';

function Marker({ focused }: { focused: boolean }) {
  return <Text color={colors.accent}>{focused ? '› ' : '  '}</Text>;
}

function rowCells(row: ResolutionRow, lists: Readonly<Record<string, LocalBranchList>>): BranchPlanCell[] {
  const error = validateRow(row, lists);
  const target = row.plan.kind === 'adopt' ? row.plan.branch : '—';
  return [
    { text: row.repo.service },
    { text: scopeLabel(row.repo) },
    { text: row.repo.currentBranch },
    { text: modeLabel(row.plan), ...(row.plan.kind === 'discard' ? { color: colors.warning } : {}) },
    { text: error !== null ? `✖ ${target === '' ? '—' : target}` : target, ...(error !== null ? { color: colors.error } : {}) },
  ];
}

function ResolutionBoxView({
  box,
  repo,
  hasOutgoing,
  lists,
}: {
  box: SwitchResolutionBox;
  repo: SwitchDirtyRepo;
  hasOutgoing: boolean;
  lists: LocalBranchList | undefined;
}) {
  const focused = (line: SwitchResolutionBox['line']) => box.line === line;
  const live = boxError(box, repo, hasOutgoing, lists);
  const error = live ?? box.error;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={colors.accent} paddingX={1}>
      <Text color={colors.accent} bold>
        Configurer {repo.service}
      </Text>
      <Box>
        <Marker focused={focused('action')} />
        <Text color={focused('action') ? colors.accent : colors.text}>
          {hasOutgoing
            ? `Action : ${box.action === 'adopt' ? '(•)' : '( )'} Adopter ${box.action === 'discard' ? '(•)' : '( )'} Écraser`
            : 'Action : (•) Écraser'}
        </Text>
      </Box>
      {box.action === 'adopt' ? (
        <Box>
          <Marker focused={focused('branch')} />
          <TextInputLine label="Branche" value={box.branch.value} cursor={box.branch.cursor} focused={focused('branch') && box.editing} />
        </Box>
      ) : null}
      {error !== null ? <Text color={colors.error}>✖ {error}</Text> : null}
      <Box>
        <Marker focused={focused('apply')} />
        <Text color={focused('apply') ? colors.accent : colors.text} bold={focused('apply')}>
          [ Appliquer ]
        </Text>
      </Box>
      <Text color={colors['text-dim']}>{RESOLUTION_BOX_FOOTER}</Text>
    </Box>
  );
}

type ConfirmLine = { key: string; text: string; color: string };

export function discardConfirmLines(rows: readonly ResolutionRow[]): ConfirmLine[] {
  const lines: ConfirmLine[] = [];
  for (const row of rows) {
    if (row.plan.kind !== 'discard') {
      continue;
    }
    const paths = row.repo.dirtyPaths;
    lines.push({
      key: `${row.repo.repoPath}:head`,
      text: paths !== undefined ? `${row.repo.service} (${paths.length} fichier(s))` : `${row.repo.service} (liste des fichiers indisponible)`,
      color: colors.warning,
    });
    for (const path of paths ?? []) {
      lines.push({ key: `${row.repo.repoPath}:${path}`, text: `    ${path}`, color: colors.text });
    }
  }
  return lines;
}

function DiscardConfirmView({
  rows,
  scroll,
  error,
  maxVisibleRows,
}: {
  rows: readonly ResolutionRow[];
  scroll: number;
  error: string | null;
  maxVisibleRows: number;
}) {
  const lines = discardConfirmLines(rows);
  const cursor = Math.min(scroll, Math.max(lines.length - 1, 0));
  return (
    <Box flexDirection="column">
      <Text color={colors.error} bold>
        CONFIRMER L'ÉCRASEMENT
      </Text>
      <Text color={colors.text}>
        Les fichiers suivants (modifications suivies et fichiers non suivis) seront définitivement détruits. Cette action est irréversible. Les fichiers ignorés par git sont conservés.
      </Text>
      <BoundedList
        items={lines}
        maxVisibleRows={maxVisibleRows}
        cursorIndex={cursor}
        moreAboveLabel="fichiers au-dessus"
        moreBelowLabel="fichiers en dessous"
        renderItem={(line) => (
          <Text key={line.key} color={line.color} wrap="truncate-end">
            {line.text}
          </Text>
        )}
      />
      {error !== null ? <Text color={colors.error}>✖ {error}</Text> : null}
      <Text color={colors['text-dim']}>{DISCARD_CONFIRM_FOOTER}</Text>
    </Box>
  );
}

export function SwitchResolutionView({
  state,
  dirty,
  targetTopic,
  maxVisibleRows,
}: {
  state: SwitchResolutionState;
  dirty: readonly SwitchDirtyRepo[];
  targetTopic: string;
  // Panel B's table / the confirmation's file list height budget (NFR-7).
  maxVisibleRows: number;
}) {
  const global = globalOf(state);
  const rows = buildRows(dirty, global);

  if (state.confirm !== null) {
    return <DiscardConfirmView rows={rows} scroll={state.confirm.scroll} error={state.confirm.error} maxVisibleRows={maxVisibleRows} />;
  }

  const box = state.box;
  const boxRepo = box !== null ? rows.find((row) => row.repo.repoPath === box.repoPath)?.repo : undefined;
  if (box !== null && boxRepo !== undefined) {
    return <ResolutionBoxView box={box} repo={boxRepo} hasOutgoing={global.hasOutgoing} lists={state.lists[box.repoPath]} />;
  }

  const outgoing = state.outgoingTopic;
  const stashed = autoStashedRepos(dirty);
  const globalFocused = state.panel === 'global';
  const lineFocused = (line: 'action' | 'name') => globalFocused && state.globalLine === line;
  const rowsFocused = state.panel === 'rows';
  const blocked = blockedRow(rows, state.lists, state.rowCursor);
  const listsPending = Object.values(state.lists).some((list) => list.status !== 'ready');
  return (
    <Box flexDirection="column">
      <Text color={colors.text}>
        {outgoing !== null
          ? `Vous quittez l'EDT « ${outgoing} » pour « ${targetTopic} ». Ces services ont des modifications non commitées hors de « ${outgoing} » : adoptez-les dans « ${outgoing} » ou écrasez-les. Les services membres de « ${outgoing} » sont mis de côté automatiquement.`
          : `Bascule vers « ${targetTopic} » : ces services ont des modifications non commitées. Les services membres de l'EDT quitté sont mis de côté automatiquement.`}
      </Text>
      <PanelTitle text="STRATÉGIE GLOBALE" focused={globalFocused} />
      <Box>
        <Marker focused={lineFocused('action')} />
        <Text color={lineFocused('action') ? colors.accent : colors.text}>
          {outgoing !== null
            ? `Action par défaut : ${state.globalAction === 'adopt' ? '(•)' : '( )'} Adopter dans ${outgoing}  ${state.globalAction === 'discard' ? '(•)' : '( )'} Écraser`
            : 'Action par défaut : (•) Écraser'}
        </Text>
      </Box>
      {outgoing === null ? (
        <Text color={colors['text-dim']}>{'  '}Aucun EDT sortant : il n'y a aucun EDT où adopter ce travail, seul l'écrasement est possible.</Text>
      ) : null}
      {outgoing !== null && state.globalAction === 'adopt' ? (
        <Box>
          <Marker focused={lineFocused('name')} />
          <TextInputLine
            label="Nom global de la branche"
            value={state.globalName.value}
            cursor={state.globalName.cursor}
            focused={lineFocused('name') && state.editing}
          />
        </Box>
      ) : null}
      <PanelTitle text="SERVICES CONCERNÉS" focused={rowsFocused} />
      <BranchPlanTable
        headers={COLUMN_HEADERS}
        rows={rows}
        rowKey={(row) => row.repo.repoPath}
        cells={(row) => rowCells(row, state.lists)}
        cursor={state.rowCursor}
        focused={rowsFocused}
        maxVisibleRows={maxVisibleRows}
        labels={{ moreAbove: 'services au-dessus', moreBelow: 'services en dessous' }}
      />
      {stashed.map((repo) => (
        <Text key={repo.repoPath} color={colors['text-dim']} wrap="truncate-end">
          {'  '}
          {repo.service} — sera mis de côté pour {outgoing ?? "l'EDT quitté"} (restauré au retour)
        </Text>
      ))}
      {blocked !== undefined ? (
        <Text color={colors.error}>
          ✖ {blocked.row.repo.service} : {blocked.error}
        </Text>
      ) : null}
      {state.error !== null ? <Text color={colors.error}>✖ {state.error}</Text> : null}
      {listsPending ? (
        <Text color={colors['text-dim']}>Branches locales en cours de chargement ou indisponibles — la vérification « existe déjà » est ignorée pour ces services.</Text>
      ) : null}
      <Text color={colors['text-dim']}>{SWITCH_RESOLUTION_FOOTER}</Text>
    </Box>
  );
}
