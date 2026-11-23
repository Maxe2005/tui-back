// tui/zones/edts: use-edts-derived — everything the EDTs zone computes from its state: rows,
// issue summary, clamped cursors, the EDT-membership partition, the terminal-rows budgets for the
// lists / wizard / switch resolution tables, and the loading flags.
import { useWindowSize } from 'ink';
import { isSystemEdt } from '../../../../../../core/edt/shared-edt.js';
import type { ServiceBranchDivergence } from '../../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/edt-registry.js';
import { autoStashedRepos } from '../dialogs/switch-resolution/switch-resolution.logic.js';
import {
  formatIssuesSummary,
  partitionServicesByEdtMembership,
  resolveCandidateListState,
  resolveIssuesSeverity,
} from '../edts-zone.logic.js';
import type { EdtsState } from './use-edts-state.js';

// Rough terminal-chrome budget (top bar, zone-tab bar, footer, the EDTS pane above the splitter,
// both section headers, and the loading/error/issues lines) subtracted from the window size
// before either service list's BoundedList sees it — an approximation, like logs-zone.tsx's
// CHROME_ROWS.
const EDTS_SERVICE_LISTS_CHROME_ROWS = 12;
// Rows the create wizard spends around Step 3's Panel B table — modal border and
// title, breadcrumb, intro, Panel A (title + 2 lines + a field's edit hint), Panel B title and
// column header, the blocked-row detail line, Step 3 footer, error line and the wizard footer.
// An approximation, as above.
const CREATE_WIZARD_CHROME_ROWS = 17;
// Rows the switch resolution view spends around its Panel B table — modal border
// and title, the (wrapping) intro, Panel A (title + 2 lines + the no-outgoing note), Panel B
// title and column header, the blocked-row detail, the Ctrl+N error, the list-loading note and
// the footer. The read-only state-1 rows below the table are added on top. An approximation.
const SWITCH_RESOLUTION_CHROME_ROWS = 17;

export function useEdtsDerived(s: EdtsState) {
  const { services, status, unreachable, errors, edts, edtsStatus, switchDirtyRepos, edtServicesSelected, otherServicesSelected, edtsSelected, dialog, paneFocus, activeEdtUlid } = s;
  // On a load error show only the error — never stale rows left over from an earlier successful
  // load, nor the detail pane content that would still reference them.
  const rows = status === 'error' ? [] : (services ?? []);
  // Same "never a stale value on error" gating as `rows` above.
  const issuesSummary = status === 'error' ? null : formatIssuesSummary(unreachable.length, errors.length);
  // Same gating as issuesSummary above — never a stale severity color on a load error either.
  const issuesSeverity = status === 'error' ? null : resolveIssuesSeverity(unreachable.length, errors.length);

  const edtsRows = edtsStatus === 'error' ? [] : (edts ?? []);
  const clampedEdtsSelected = edtsRows.length === 0 ? 0 : Math.min(edtsSelected, edtsRows.length - 1);
  const focusedEdt: EdtRegistryEntry | undefined = edtsRows[clampedEdtsSelected];

  // "Empty" means no user EDT: the system EDT alone must still auto-open the create wizard.
  const userEdtCount = edtsRows.filter((entry) => !isSystemEdt(entry)).length;
  // The focused EDT is the read-only system "Shared branches" one: Enter switches to it (unless it
  // is already active); every other action key explains the read-only rule instead.
  const focusedIsSystem = isSystemEdt(focusedEdt);
  const focusedIsActive = focusedEdt !== undefined && focusedEdt.ulid === activeEdtUlid;
  const systemEdtFooter: 'switch' | 'readonly' | 'fast-forward' | null = !focusedIsSystem
    ? null
    : paneFocus === 'edts'
      ? focusedIsActive
        ? 'fast-forward'
        : 'switch'
      : 'readonly';

  const candidates = rows; // the flat services list doubles as the create/modify candidate pool
  const candidateState = resolveCandidateListState(status, candidates.length);

  // The services list, partitioned against the *selected* EDT's membership — each half is its
  // own independently arrow/Home/End-navigable pane.
  const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);
  const clampedEdtServicesSelected = edtServices.length === 0 ? 0 : Math.min(edtServicesSelected, edtServices.length - 1);
  const clampedOtherServicesSelected = otherServices.length === 0 ? 0 : Math.min(otherServicesSelected, otherServices.length - 1);
  const focusedEdtService: ServiceBranchDivergence | undefined = edtServices[clampedEdtServicesSelected];
  const focusedOtherService: ServiceBranchDivergence | undefined = otherServices[clampedOtherServicesSelected];

  // Both service lists are bounded to the terminal's rows (an unbounded list corrupts Ink's
  // diff-render, as in the Logs zone). A rough total-rows budget for this zone's list column —
  // an approximation like logs-zone.tsx's CHROME_ROWS, not a splitter-ratio measurement —
  // handed out top-down (EDT SERVICES first, OTHER SERVICES the remainder) so a short EDT
  // SERVICES list leaves more room for OTHER SERVICES. Only the rendered window is bounded.
  const windowSize = useWindowSize();
  const servicesListsAvailableHeight = Math.max(windowSize.rows - EDTS_SERVICE_LISTS_CHROME_ROWS, 4);
  // The create wizard's Step 3 table budget (NFR-7), same live pattern as above.
  const createWizardTableMaxRows = Math.max(windowSize.rows - CREATE_WIZARD_CHROME_ROWS, 3);
  // The switch resolution table / discard file-list budget (NFR-7), same pattern.
  const switchResolutionMaxRows = Math.max(
    windowSize.rows - SWITCH_RESOLUTION_CHROME_ROWS - (switchDirtyRepos !== null ? autoStashedRepos(switchDirtyRepos).length : 0),
    3,
  );
  const edtServicesMaxVisibleRows = servicesListsAvailableHeight;
  // An empty EDT SERVICES list still renders a 1-row placeholder ("No services in this EDT."), so
  // it counts as 1 row, not the BoundedList's 0 — otherwise OTHER SERVICES would be 1 row over
  // budget.
  const edtServicesConsumedRows = edtServices.length === 0 ? 1 : Math.min(edtServices.length, edtServicesMaxVisibleRows);
  const otherServicesMaxVisibleRows = Math.max(1, servicesListsAvailableHeight - edtServicesConsumedRows);

  const dialogOpen = dialog.kind !== 'none';
  const loading = status === 'loading' && rows.length === 0;
  const edtsLoading = edtsStatus === 'loading' && edts === null;

  return {
    rows,
    issuesSummary,
    issuesSeverity,
    edtsRows,
    clampedEdtsSelected,
    focusedEdt,
    userEdtCount,
    focusedIsSystem,
    focusedIsActive,
    systemEdtFooter,
    candidates,
    candidateState,
    edtServices,
    otherServices,
    clampedEdtServicesSelected,
    clampedOtherServicesSelected,
    focusedEdtService,
    focusedOtherService,
    createWizardTableMaxRows,
    switchResolutionMaxRows,
    edtServicesMaxVisibleRows,
    otherServicesMaxVisibleRows,
    dialogOpen,
    loading,
    edtsLoading,
  };
}

export type EdtsDerived = ReturnType<typeof useEdtsDerived>;
