// tui/zones/update: last-update recap formatting and the zone's footer-context resolution.
import { SHARED_EDT_TOPIC, isSharedEdtTopic } from '../../../../../../core/edt/shared-edt/shared-edt.js';
import type { GroupUpdateRepoResult, GroupUpdateSelectionItem } from '../../../../../../core/scripts/group-update.js';
import type { FooterContextId } from '../../../keybindings/index.js';

// The recap view's body: the last run's context (who it covered, from which sources to which
// branches) followed by one line per covered service. `sources` are the confirmed per-service
// merge sources (empty: the manifest shared branches); `branches` the services' current
// branches. Null when no run has finished in this session.
export interface LastUpdateRecap {
  title: string;
  contextLines: string[];
  resultLines: string[];
}

export function formatLastUpdateRecap(
  topic: string | null,
  results: readonly GroupUpdateRepoResult[],
  selection: readonly GroupUpdateSelectionItem[] | null,
  branchByService: Readonly<Record<string, string | null>>,
): LastUpdateRecap | null {
  if (topic === null) {
    return null;
  }
  const isAll = topic === 'all-repos';
  const shared = isSharedEdtTopic(topic);
  const title = isAll ? 'Last update — all repos' : shared ? `Last update — ${SHARED_EDT_TOPIC}` : `Last update — EDT "${topic}"`;
  const contextLines = [
    isAll ? 'Scope: every managed repo' : shared ? 'Scope: all shared branches' : `Scope: members of EDT "${topic}"`,
    `Services covered: ${String(results.length)}`,
  ];
  const resultLines = results.map((row) => {
    const glyph = row.outcome === 'updated' ? '✔' : row.outcome === 'skipped' ? '○' : '✖';
    const source = selection?.find((item) => item.service === row.service)?.sourceBranch ?? 'shared branch';
    const target = branchByService[row.service] ?? '?';
    const detail =
      row.detail !== undefined ? ` (${row.detail.code})${row.detail.message !== '' ? `: ${row.detail.message.replace(/\s+/g, ' ').trim()}` : ''}` : '';
    return `${glyph} ${row.service}  ${source} → ${target}  ${row.outcome}${detail}`;
  });
  return { title, contextLines, resultLines };
}

// The recap view toggle: `Esc` drops service focus (the right pane shows the last-update
// recap); any list-navigation key hands focus back to the remembered service without moving it.
// `handled` tells the dispatcher the key is consumed.
export function resolveRecapToggle(
  recapActive: boolean,
  key: { ctrl?: boolean; meta?: boolean; escape?: boolean; upArrow?: boolean; downArrow?: boolean; home?: boolean; end?: boolean },
): { recapActive: boolean; handled: boolean } {
  if (key.escape === true) {
    return { recapActive: true, handled: !recapActive };
  }
  const navigates = key.upArrow === true || key.downArrow === true || key.home === true || key.end === true;
  if (recapActive && navigates) {
    return { recapActive: false, handled: true };
  }
  return { recapActive, handled: false };
}

// The last-update context line: where the service came from and where it went. `source` is the
// confirmed override, else the manifest's shared branch; `target` the service's branch, and the
// EDT topic of the run when it had one.
export function formatServiceUpdateContext(source: string | undefined, target: string | null, topic: string | null): string {
  const edt = topic !== null && topic !== 'all-repos' ? (isSharedEdtTopic(topic) ? ` (${SHARED_EDT_TOPIC})` : ` (EDT ${topic})`) : '';
  return `${source ?? 'shared branch'} → ${target ?? '?'}${edt}`;
}

export type UpdateFooterInput = {
  // The incident popup is open on a guided menu / on its incident list.
  blocker: boolean;
  incidentList?: boolean;
  // The pre-run config screen's own context when it is open (see updateConfigFooterContext).
  config: FooterContextId | null;
  servicePick: boolean;
  quitConfirm: boolean;
  serviceMenu: boolean;
  // A `:update-service` request waiting for its service list or pick: nothing to press yet.
  selectRequest: boolean;
  // The full-screen service report is open.
  report: boolean;
};

// The layer that owns the keyboard, in the same priority order as the zone's key handler.
export function updateFooterContext(input: UpdateFooterInput): FooterContextId | null {
  if (input.blocker) {
    return 'menu';
  }
  if (input.incidentList === true) {
    return 'update-incidents';
  }
  if (input.config !== null) {
    return input.config;
  }
  if (input.servicePick) {
    return 'menu';
  }
  if (input.quitConfirm) {
    return 'confirm';
  }
  if (input.serviceMenu) {
    return 'menu';
  }
  if (input.report) {
    return 'update-report';
  }
  return input.selectRequest ? 'busy' : null;
}
