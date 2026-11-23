// tui/zones/update: use-update-derived — everything the Update zone computes from its state each
// render: incident popup derivations, the service rows / panes / cursor clamp, run targeting, the
// full report's input and content, labels, and the recap / detail-pane data. Pure derivation: no
// effects, no key handling.
import { resolve as resolvePath } from 'node:path';
import type { UpdateBlockerChoice } from '../../../../../../core/scripts/group-update.js';
import { spacing } from '../../../shared/theme/theme.js';
import {
  PENDING_STEPS,
  buildServiceReport,
  formatLastUpdateRecap,
  formatLiveServiceDetail,
  formatServiceOutcomeDetail,
  formatServiceUpdateContext,
  inferSettledSteps,
  isServiceTargetedByRun,
  partitionUpdateServiceRows,
  resolveUpdatePaneRows,
  splitUpdateServiceRows,
} from '../logic/update-zone.logic.js';
import { visibleServiceMenuItems } from '../services/update-service-menu-dialog.js';
import { formatQuitRunCounts } from '../incidents/update-incidents.logic.js';
import { UPDATE_ALL_RUNNING_LABEL, UPDATE_RUNNING_LABEL, UPDATE_SELECTION_RUNNING_LABEL, shouldOfferRerun } from '../logic/update-zone.resolvers.logic.js';
import { UPDATE_SERVICE_LIST_CHROME_ROWS } from '../update-zone.ctx.js';
import type { UpdateState } from './use-update-state.js';

export function useUpdateDerived(s: UpdateState) {
  const {
    updateStatus, updateResults, updateTopic, updateScope, updateSelection, incidents, incidentPopupOpen,
    incidentMode, incidentIndex, setIncidentMode, resolveUpdateIncident, services, servicesStatus, edts, activeEdt,
    serviceMenuRestartAvailable, serviceMenuCursor, serviceCursor, recapActive, liveServiceDone, liveSharedTypesPhase,
    liveServicePhase, liveServiceIssues, liveServiceSteps, lastServiceRuns, lastServiceOutcomes, serviceRestartInFlight,
    reportService, bounds, windowSize, membersRatio,
  } = s;
  const awaitingServices = new Set(incidents.map((incident) => incident.blocker.service));
  const popupOpen = incidentPopupOpen && incidents.length > 0;
  const selectedIncidentIndex = Math.min(incidentIndex, Math.max(incidents.length - 1, 0));
  const selectedIncident = incidents[selectedIncidentIndex];
  // The guided menu's blocker: only while the popup's menu mode is active.
  const updateBlocker = popupOpen && incidentMode === 'menu' ? (selectedIncident?.blocker ?? null) : null;
  const incidentListActive = popupOpen && incidentMode === 'list';
  const resolveUpdateBlocker = (choice: UpdateBlockerChoice): void => {
    if (selectedIncident !== undefined) {
      resolveUpdateIncident(selectedIncident.id, choice);
    }
    setIncidentMode('list');
  };

  const rows = servicesStatus === 'error' ? [] : (services ?? []);
  const focusedEdt = (edts ?? []).find((entry) => entry.ulid === activeEdt);
  const allServiceRows = partitionUpdateServiceRows(rows, focusedEdt);
  // The open row-local menu's visible rows — the restart row drops out for a container-less
  // service without a recipe (see describeServiceRestart), and the cursor clamps with it so
  // a row that arrived while browsing never points past the last visible item.
  const serviceMenuItems = visibleServiceMenuItems(serviceMenuRestartAvailable);
  const clampedServiceMenuCursor = Math.min(serviceMenuCursor, serviceMenuItems.length - 1);

  // This run's currently-targeted services — an all-repos run targets every listed service; an
  // EDT-scoped run only the active EDT's members (the same `runningMembers` the spinner below
  // reads). A run confirmed with a narrowed selection targets only the selected rows inside that
  // scope — see isServiceTargetedByRun.
  const edtMembers = edts?.find((entry) => entry.ulid === activeEdt)?.members ?? [];
  const isAllRun = updateScope === 'all';
  const runningMemberPaths = new Set(edtMembers.map((member) => member.repoPath));
  const runTarget = { scope: isAllRun ? ('all' as const) : ('edt' as const), memberPaths: runningMemberPaths, selection: updateSelection };
  // Whether the in-flight run covers this row at all (finished services included), vs.
  // `isRowTargeted`: covered and still being processed.
  const isRowInRun = (row: { service: string; path: string }): boolean =>
    updateStatus === 'running' && isServiceTargetedByRun(row, runTarget);
  const isRowTargeted = (row: { service: string; path: string }): boolean => isRowInRun(row) && (liveServiceDone[row.service] !== true || liveSharedTypesPhase[row.service] !== undefined);
  // During a run the list keeps only the services the run covers.
  const serviceRows = updateStatus === 'running' ? allServiceRows.filter(isRowInRun) : allServiceRows;
  const panes = splitUpdateServiceRows(serviceRows);
  const clampedServiceCursor = serviceRows.length === 0 ? 0 : Math.min(serviceCursor, serviceRows.length - 1);
  const selectedServiceRow = serviceRows[clampedServiceCursor];
  // Triggers act on a focused service only — never on the remembered cursor behind the recap.
  const focusedServiceRow = recapActive ? undefined : selectedServiceRow;
  const runningMembers = edtMembers.filter((member) => isRowTargeted({ service: member.service, path: member.repoPath }));
  // A narrowed all-scope run (a single service outside the active EDT) names its selected
  // rows — the generic "loading members" line is only for the unfiltered all-repos run.
  const runningSelectedRows = isAllRun && updateSelection !== null ? serviceRows.filter(isRowTargeted) : [];
  const servicePaths = rows.map((row) => row.path).join('\u0000');

  // The full report's content for a service, read from the store every render: the live steps and
  // issue log while a run targets it, the settled last run afterwards (falling back to its last
  // outcome row when no run snapshot exists). `available` drives whether `f` opens anything.
  const reportInputFor = (service: string) => {
    const row = serviceRows.find((candidate) => candidate.service === service);
    const live = row !== undefined && (isRowTargeted(row) || serviceRestartInFlight[resolvePath(row.path)] !== undefined);
    const run = lastServiceRuns[service];
    const outcome = lastServiceOutcomes[service] ?? updateResults.find((candidate) => candidate.service === service);
    const issues = liveServiceIssues[service] ?? [];
    const settled = run ?? (outcome !== undefined ? { steps: inferSettledSteps(outcome), result: outcome, source: undefined, target: row?.branch ?? null, topic: updateTopic } : undefined);
    const mode: 'live' | 'last' | 'never' = live ? 'live' : settled !== undefined ? 'last' : 'never';
    return {
      available: live || settled !== undefined || issues.length > 0,
      input: {
        service,
        mode,
        context: settled !== undefined && !live ? formatServiceUpdateContext(settled.source, settled.target, settled.topic) : null,
        steps: live ? (liveServiceSteps[service] ?? PENDING_STEPS) : settled?.steps,
        result: live ? undefined : settled?.result,
        issues,
      },
    };
  };
  const report = reportService !== null ? buildServiceReport(reportInputFor(reportService).input) : null;
  const REPORT_HEADER_ROWS = 1;
  const reportBudget = Math.max(1, bounds.rows - REPORT_HEADER_ROWS);
  const reportWidth = Math.max(1, bounds.columns - 2 * spacing['pane-padding-x']);
  const reportAvailable = reportService !== null && reportInputFor(reportService).available;

  // The active EDT's own membership — the per-service spinner rows during a run, before the
  // core use-case resolves with its per-service outcome rows. An all-repos run targets no
  // single EDT, so it shows the generic loading line instead of EDT member rows.
  const offerRerun = shouldOfferRerun(edts, activeEdt);
  const baseRunningLabel = !isAllRun ? UPDATE_RUNNING_LABEL : updateSelection !== null ? UPDATE_SELECTION_RUNNING_LABEL : UPDATE_ALL_RUNNING_LABEL;
  // Services paused on an incident are not in flight: they wait on the developer.
  const quitCounts = formatQuitRunCounts(
    incidents.length,
    [...new Set([...Object.keys(liveServicePhase), ...Object.keys(liveSharedTypesPhase)])].filter((service) => !awaitingServices.has(service)).length,
  );
  // The zone header counts the pending incidents next to the run label.
  const runningLabel = incidents.length > 0 ? `${baseRunningLabel} · ◐ ${incidents.length} awaiting you (i)` : baseRunningLabel;

  // This zone's service-list chrome budget (an approximation, like edts-zone.tsx/logs-zone.tsx).
  const serviceListMaxVisibleRows = Math.max(windowSize.rows - UPDATE_SERVICE_LIST_CHROME_ROWS, 3);
  const paneRows = resolveUpdatePaneRows(serviceListMaxVisibleRows, membersRatio);
  // Pane-local cursor: members come first in the flat row array, so others are offset by them.
  const cursorInMembers = clampedServiceCursor < panes.members.length;

  const branchByService = Object.fromEntries(serviceRows.map((row) => [row.service, row.branch]));
  const recap = formatLastUpdateRecap(updateTopic, updateResults, updateSelection, branchByService);
  const selectedLastOutcome = selectedServiceRow !== undefined ? lastServiceOutcomes[selectedServiceRow.service] : undefined;

  // The live per-service view — while a run targets the selected service the detail pane shows
  // its current step plus the issue log (resolved/unresolved) instead of the last-outcome view;
  // afterwards it reverts to the final outcome. A standalone restart reports through the same
  // channel; before its first emission the formatter reports `starting`, never a stale outcome.
  const selectedLivePhase = selectedServiceRow !== undefined ? liveServicePhase[selectedServiceRow.service] : undefined;
  const selectedLiveIssues = selectedServiceRow !== undefined ? (liveServiceIssues[selectedServiceRow.service] ?? []) : [];
  const isSelectedTargeted = selectedServiceRow !== undefined && isRowTargeted(selectedServiceRow);
  const isSelectedRestarting =
    selectedServiceRow !== undefined && serviceRestartInFlight[resolvePath(selectedServiceRow.path)] !== undefined;
  const selectedRun = selectedServiceRow !== undefined ? lastServiceRuns[selectedServiceRow.service] : undefined;
  const showLiveDetail = isSelectedTargeted || isSelectedRestarting;
  const detailBody =
    selectedServiceRow === undefined
      ? 'No service selected.'
      : showLiveDetail
        ? formatLiveServiceDetail(selectedLivePhase, selectedLiveIssues, selectedServiceRow !== undefined ? liveSharedTypesPhase[selectedServiceRow.service] : undefined)
        : formatServiceOutcomeDetail(selectedLastOutcome);

  return {
    awaitingServices, popupOpen, selectedIncidentIndex, selectedIncident, updateBlocker, incidentListActive, resolveUpdateBlocker,
    rows, serviceMenuItems, clampedServiceMenuCursor, isAllRun, isRowTargeted, serviceRows, panes, clampedServiceCursor,
    selectedServiceRow, focusedServiceRow, runningMembers, runningSelectedRows, servicePaths, reportInputFor, report,
    reportBudget, reportWidth, reportAvailable, offerRerun, quitCounts, runningLabel, paneRows, cursorInMembers,
    recap, selectedLastOutcome, selectedLiveIssues, isSelectedTargeted, isSelectedRestarting, selectedRun, detailBody,
  };
}

export type UpdateDerived = ReturnType<typeof useUpdateDerived>;
