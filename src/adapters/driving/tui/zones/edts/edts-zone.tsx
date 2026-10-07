// tui/zones/edts: the EDTs zone — an EDT selector with its dialogs (create wizard, switch,
// modify, delete, quick-pick, service actions) above the EDT SERVICES / OTHER SERVICES lists,
// all Tab-cycled panes, driving core/edt use-cases in-process (AD-2). Every keystroke decision is
// a pure function in edts-zone.logic.ts; DetailPane takes only Text-safe content (UX-DR17), so a
// git-error detail renders as a DimAnnotation sibling.
import { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput, useWindowSize, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ZoneLayout } from '../../shared/components/zone-layout.js';
import { ListRow } from '../../shared/components/list-row.js';
import { resolveFocusStep } from '../../shared/keys/focus-navigation.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  appendHint,
  cyclePaneFocus,
  PANE_FOCUS_NAV,
  formatEdtActionHistory,
  formatEdtDetail,
  formatEdtRowMeta,
  formatIssuesSummary,
  formatServiceDetail,
  formatServiceMeta,
  initialAddToEdtDialog,
  initialCreateDialog,
  initialDeleteDialog,
  initialIssuesDialog,
  initialModifyDialog,
  initialQuickPickDialog,
  initialServiceActionsDialog,
  initialSwitchDialog,
  jumpSelection,
  moveSelection,
  partitionServicesByEdtMembership,
  resolveIssuesSeverity,
  type PaneFocus,
  resolveActionHint,
  resolveCandidateListState,
  resolveSelectionDirection,
  resolveSelectionJump,
  type DeleteDialogState,
  type EdtDialogState,
} from './edts-zone.logic.js';
import { createAddToEdtDialogHandlers, AddToEdtDialogView } from './dialogs/add-to-edt-dialog.js';
import { createCreateWizardHandlers, CreateWizardView } from './dialogs/create-wizard/create-wizard.js';
import { createDeleteDialogHandlers, DeleteDialogView } from './dialogs/delete-dialog.js';
import { IssuesDialogView } from './dialogs/issues-dialog.js';
import { createModifyDialogHandlers, ModifyDialogView } from './dialogs/modify-dialog.js';
import { createQuickPickDialogHandlers, resolveQuickPickCandidates, QuickPickDialogView } from './dialogs/quick-pick-dialog.js';
import { createServiceActionsDialogHandlers, ServiceActionsDialogView } from './dialogs/service-actions-dialog.js';
import { createSwitchDialogHandlers, SwitchDialogView } from './dialogs/switch-dialog.js';
import {
  autoStashedRepos,
  initialSwitchResolution,
  otherEdtBranches,
  resolutionRepos,
  type LocalBranchList,
} from './dialogs/switch-resolution/switch-resolution.logic.js';

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

export function EdtsZone({
  useStore = useAppStore,
  // Test-only injection point (like `useStore` above): renderToString's fake stdin never emits a
  // real keypress, so a smoke test can't Tab its way to the SERVICES pane. Production always
  // starts on 'edts' — the EDT selector.
  initialPaneFocus = 'edts',
  // Test-only injection point: renderToString performs one synchronous render-then-unmount pass
  // and never observes a *second*, effect-triggered commit — so a smoke test can't rely on the
  // "zero EDTs auto-opens the create dialog" effect having run. The interaction tests exercise
  // that effect through a real Ink render loop; this prop only seeds the same initial state.
  // Production always starts with no dialog open.
  initialDialogKind,
}: {
  useStore?: AppStore;
  initialPaneFocus?: PaneFocus;
  initialDialogKind?:
    | 'create'
    | 'switch-confirm'
    | 'switch-blocked'
    | 'modify'
    | 'service-actions'
    | 'add-to-edt'
    | 'delete-confirm'
    | 'delete-confirm-rejected'
    | 'delete-confirm-status-error'
    | 'issues'
    | 'quick-pick';
}) {
  const resizeMode = useStore((state) => state.resizeMode);
  const services = useStore((state) => state.edtsBranches);
  const status = useStore((state) => state.edtsBranchesStatus);
  const error = useStore((state) => state.edtsBranchesError);
  const unreachable = useStore((state) => state.edtsUnreachable);
  const errors = useStore((state) => state.edtsErrors);
  const loadEdtsBranches = useStore((state) => state.loadEdtsBranches);
  const edts = useStore((state) => state.edts);
  const edtsStatus = useStore((state) => state.edtsStatus);
  const edtsError = useStore((state) => state.edtsError);
  const activeEdtUlid = useStore((state) => state.activeEdt);
  const loadEdts = useStore((state) => state.loadEdts);
  const createEdtAction = useStore((state) => state.createEdt);
  // The create wizard's Step 4 first-EDT activation.
  const activateEdtAction = useStore((state) => state.activateEdt);
  const switchEdtAction = useStore((state) => state.switchEdt);
  // The switch dirty-repo confirm seam (edt-slice.ts).
  const switchDirtyRepos = useStore((state) => state.switchDirtyRepos);
  const resolveSwitchDirtyRepos = useStore((state) => state.resolveSwitchDirtyRepos);
  const modifyEdtAction = useStore((state) => state.modifyEdt);
  const deleteEdtAction = useStore((state) => state.deleteEdt);
  const resolveMemberDeleteStatusesAction = useStore((state) => state.resolveMemberDeleteStatuses);
  // The shared branch-picker's store actions — `deps.git` is never touched directly from this
  // zone; these wrap core/edt/modify.ts's listMemberBranches/createMemberBranch/
  // renameMemberBranch exports.
  const listBranchesAction = useStore((state) => state.listBranches);
  // The create wizard's Step 3 per-service lists (local + remote-tracking refs).
  const listCreateBranchesAction = useStore((state) => state.listCreateBranches);
  const createMemberBranchAction = useStore((state) => state.createMemberBranch);
  const renameBranchAction = useStore((state) => state.renameBranch);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const requestQuit = useStore((state) => state.requestQuit);
  // Ink dispatches every keypress to every mounted `useInput` hook regardless of z-order, so
  // without this gate Tab/Enter typed into the `:` command bar would also fire this zone's own
  // pane-focus toggle / openEdtAction() underneath it.
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  // The same leakage applies to the registry and settings screens, overlays rendered on top of
  // this zone while it stays mounted: without this gate their keys would also drive this zone's
  // pane focus, list cursor and dialogs.
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  const resetScreenOpen = useStore((state) => state.resetScreenOpen);
  // EDT action state for the detail pane — tracks the in-progress action and the action log
  const currentEdtAction = useStore((state) => state.currentEdtAction);
  const setCurrentEdtAction = useStore((state) => state.setCurrentEdtAction);
  const edtActionLog = useStore((state) => state.edtActionLog);
  const edtActionLogStatus = useStore((state) => state.edtActionLogStatus);
  const loadEdtActionLog = useStore((state) => state.loadEdtActionLog);
  const logEdtAction = useStore((state) => state.logEdtAction);
  // Hides a per-context action hint from the detail pane as soon as it is toggled in the settings
  // screen's EDTs tab.
  const hiddenActionHints = useStore((state) => state.settings.edts.hiddenActionHints);
  const hiddenActionTypes = useStore((state) => state.settings.edts.hiddenActionTypes);
  // The shared branch autocomplete's visible row cap — threaded into every BranchPicker
  // session's pick-existing filter (no per-service override, no new setting of its own).
  const branchDropdownMaxRows = useStore((state) => state.settings.edts.branchDropdownMaxRows);

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // On a load error show only the error — never stale rows left over from an earlier successful
  // load, nor the detail pane content that would still reference them.
  const rows = status === 'error' ? [] : (services ?? []);
  // Same "never a stale value on error" gating as `rows` above.
  const issuesSummary = status === 'error' ? null : formatIssuesSummary(unreachable.length, errors.length);
  // Same gating as issuesSummary above — never a stale severity color on a load error either.
  const issuesSeverity = status === 'error' ? null : resolveIssuesSeverity(unreachable.length, errors.length);

  // ---- EDT selector and dialogs ------------------------------------------------------------
  const [paneFocus, setPaneFocus] = useState<PaneFocus>(initialPaneFocus);
  const [edtsSelected, setEdtsSelected] = useState(0);
  // One cursor per partitioned pane (EDT SERVICES / OTHER SERVICES) — each keeps its own
  // position as paneFocus cycles between them, as edtsSelected does for the EDT selector.
  const [edtServicesSelected, setEdtServicesSelected] = useState(0);
  const [otherServicesSelected, setOtherServicesSelected] = useState(0);
  const [dialog, setDialog] = useState<EdtDialogState>(() => {
    if (initialDialogKind === undefined) {
      return { kind: 'none' };
    }
    if (initialDialogKind === 'create') {
      return initialCreateDialog();
    }
    if (initialDialogKind === 'issues') {
      return initialIssuesDialog();
    }
    if (initialDialogKind === 'quick-pick') {
      // Test-only seed (like 'create'/'issues' above): defaults to switch mode — a smoke test only
      // needs one representative mode's chrome; real per-mode coverage goes through the
      // interaction tests, driving the actual currentEdtAction -> quick-pick effect below.
      return initialQuickPickDialog('switch');
    }
    const target = useStore.getState().edts?.[0];
    if (target === undefined) {
      return { kind: 'none' };
    }
    if (initialDialogKind === 'switch-confirm') {
      return initialSwitchDialog(target);
    }
    if (initialDialogKind === 'switch-blocked') {
      return { ...initialSwitchDialog(target), blocked: true, error: 'An action is in progress on the current EDT.' };
    }
    if (initialDialogKind === 'service-actions') {
      const branches = useStore.getState().edtsBranches ?? [];
      const memberPath = target.members[0]?.repoPath;
      const svc = branches.find((candidate) => candidate.path === memberPath);
      if (svc === undefined) {
        return { kind: 'none' };
      }
      return initialServiceActionsDialog(target, svc.path, svc.service);
    }
    if (initialDialogKind === 'add-to-edt') {
      const branches = useStore.getState().edtsBranches ?? [];
      const memberPaths = new Set(target.members.map((member) => member.repoPath));
      const svc = branches.find((candidate) => !memberPaths.has(candidate.path));
      if (svc === undefined) {
        return { kind: 'none' };
      }
      return initialAddToEdtDialog(target, svc.path, svc.service, svc.branch, svc.sharedBranch);
    }
    if (initialDialogKind === 'delete-confirm-rejected') {
      return initialDeleteDialog(target, true);
    }
    if (initialDialogKind === 'delete-confirm') {
      // Test-only seed (mirrors service-actions/add-to-edt's own static seeding above):
      // renderToString never observes the real effect-driven listBranches/status fetch, so
      // memberRows is pre-populated here directly rather than left `null` (which would render
      // as "Loading member status…" forever in a one-shot smoke test).
      const dialog = initialDeleteDialog(target, false);
      return {
        ...dialog,
        memberRows: target.members.map((member) => ({
          repoPath: member.repoPath,
          service: member.service,
          branch: member.branch,
          merged: false,
          clean: true,
          disposition: 'leave' as const,
        })),
      };
    }
    if (initialDialogKind === 'delete-confirm-status-error') {
      // Test-only seed: one row carries a statusError (the shape resolveMemberDeleteStatuses
      // returns when a manifest/git read fails) so formatDeleteMemberMeta's "(status unknown —
      // defaulted to leave)" annotation has real rendering coverage.
      const dialog = initialDeleteDialog(target, false);
      return {
        ...dialog,
        memberRows: target.members.map((member) => ({
          repoPath: member.repoPath,
          service: member.service,
          branch: member.branch,
          merged: false,
          clean: true,
          disposition: 'leave' as const,
          statusError: 'no manifest',
        })),
      };
    }
    return initialModifyDialog(target);
  });

  const edtsRows = edtsStatus === 'error' ? [] : (edts ?? []);
  const clampedEdtsSelected = edtsRows.length === 0 ? 0 : Math.min(edtsSelected, edtsRows.length - 1);
  const focusedEdt: EdtRegistryEntry | undefined = edtsRows[clampedEdtsSelected];

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

  // Arrowing within the `edts` pane changes `focusedEdt` — and therefore the contents of both
  // partitioned service panes — without touching their cursors, which could then land on a row
  // unrelated to the newly selected EDT. Reset both to the top whenever the selected EDT changes.
  useEffect(() => {
    setEdtServicesSelected(0);
    setOtherServicesSelected(0);
  }, [focusedEdt?.ulid]);

  const dialogOpen = dialog.kind !== 'none';

  // No EDT exists -> the create wizard, never a bare/empty list. Auto-opens once the list has
  // genuinely resolved to empty (never while still loading, never on a load error).
  useEffect(() => {
    if (edtsStatus === 'idle' && edts !== null && edts.length === 0 && dialog.kind === 'none') {
      setDialog(initialCreateDialog());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edtsStatus, edts]);

  // Gate app-shell's global shortcuts (help/filter/command/zone-mnemonic/quit) while any dialog
  // here owns the keystroke.
  useEffect(() => {
    setZoneInputCaptured(dialogOpen);
  }, [dialogOpen, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  // Fetches a branch-picker session's own listBranches(repoPath) once, whenever a session opens
  // (via createPickerSession's branchesStatus: 'loading' seed) — never re-fetched on every
  // render. A stale response (the picker closed, or another repoPath's session opened, before
  // this resolved) is dropped rather than applied. The create wizard's Step 3 lists load through
  // its own loadPendingBranchLists (effect below).
  const activeBranchPicker =
    dialog.kind === 'modify' || dialog.kind === 'service-actions' || dialog.kind === 'add-to-edt' ? dialog.branchPicker : null;
  // Keyed on repoPath/branchesStatus (primitives) rather than the activeBranchPicker object
  // itself — that object is freshly spread on every keystroke inside the picker (session.state
  // updates), which would otherwise re-fire this effect (and spawn a new listBranches() git
  // call) on every keystroke typed while still 'loading', instead of once per session-open.
  const activeBranchPickerRepoPath = activeBranchPicker?.repoPath ?? null;
  const activeBranchPickerStatus = activeBranchPicker?.branchesStatus ?? null;
  useEffect(() => {
    if (activeBranchPickerRepoPath === null || activeBranchPickerStatus !== 'loading') {
      return;
    }
    let cancelled = false;
    const repoPath = activeBranchPickerRepoPath;
    void (async () => {
      const result = await listBranchesAction(repoPath);
      if (cancelled) {
        return;
      }
      setDialog((prev) => {
        if (prev.kind !== 'modify' && prev.kind !== 'service-actions' && prev.kind !== 'add-to-edt') {
          return prev;
        }
        if (prev.branchPicker === null || prev.branchPicker.repoPath !== repoPath || prev.branchPicker.branchesStatus !== 'loading') {
          return prev;
        }
        return {
          ...prev,
          branchPicker: { ...prev.branchPicker, branches: result.ok ? result.data : [], branchesStatus: result.ok ? 'ready' : 'error' },
        };
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [activeBranchPickerRepoPath, activeBranchPickerStatus, listBranchesAction]);

  // Command-triggered dialogs via currentEdtAction state: when a command sets currentEdtAction,
  // open the corresponding dialog.
  useEffect(() => {
    if (currentEdtAction && dialog.kind === 'none') {
      if (currentEdtAction.type === 'create') {
        setDialog(initialCreateDialog());
        setCurrentEdtAction(null);
      } else if (currentEdtAction.type === 'switch') {
        // If a topic was specified, find the EDT and open switch-confirm pre-targeted
        if (currentEdtAction.target !== 'select EDT') {
          const targetEdt = edtsRows.find((e) => e.topic === currentEdtAction.target);
          if (targetEdt) {
            setDialog(initialSwitchDialog(targetEdt));
            setCurrentEdtAction(null);
          } else {
            // EDT not found - will be handled by the dialog's error state
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        } else {
          // No topic specified — open the quick-pick (switch mode) instead of guessing a target.
          // The picker's own Enter handler opens initialSwitchDialog(target) once a topic is
          // chosen.
          setDialog(initialQuickPickDialog('switch'));
          setCurrentEdtAction(null);
        }
      } else if (currentEdtAction.type === 'modify') {
        // If a topic was specified, find the EDT and open modify dialog pre-targeted
        if (currentEdtAction.target !== 'select EDT') {
          const targetEdt = edtsRows.find((e) => e.topic === currentEdtAction.target);
          if (targetEdt) {
            setDialog(initialModifyDialog(targetEdt));
            setCurrentEdtAction(null);
          } else {
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        } else {
          // No topic specified — open the quick-pick (modify mode), filtering every EDT (active
          // included), instead of guessing "the focused row".
          setDialog(initialQuickPickDialog('modify'));
          setCurrentEdtAction(null);
        }
      } else if (currentEdtAction.type === 'create-from') {
        // A known topic opens the wizard seeded from that root EDT; an unknown one opens the
        // create-from quick-pick with an inline not-found error; no topic opens the quick-pick
        // plain (every EDT, active included).
        if (currentEdtAction.target !== 'select EDT') {
          const targetEdt = edtsRows.find((e) => e.topic === currentEdtAction.target);
          setDialog(
            targetEdt
              ? initialCreateDialog(targetEdt)
              : initialQuickPickDialog('create-from', `EDT not found: "${currentEdtAction.target}"`),
          );
        } else {
          setDialog(initialQuickPickDialog('create-from'));
        }
        setCurrentEdtAction(null);
      } else if (currentEdtAction.type === 'delete') {
        // The active EDT can never be deleted: initialDeleteDialog enforces this at open time
        // (isActive param) — the dialog still opens for an active target, just showing the
        // rejection message (never auto-switched).
        if (currentEdtAction.target !== 'select EDT') {
          const targetEdt = edtsRows.find((e) => e.topic === currentEdtAction.target);
          if (targetEdt) {
            setDialog(initialDeleteDialog(targetEdt, targetEdt.ulid === activeEdtUlid));
            setCurrentEdtAction(null);
          } else {
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        } else {
          // No topic specified — open the quick-pick (delete mode), filtering every EDT (active
          // included). Selecting the active EDT there still opens the rejection dialog
          // (initialDeleteDialog's isActive check).
          setDialog(initialQuickPickDialog('delete'));
          setCurrentEdtAction(null);
        }
      }
    }
  }, [currentEdtAction, dialog.kind, edtsRows, activeEdtUlid, setDialog, setCurrentEdtAction]);

  // Load the action log when an EDT row is focused, tracking which EDT was loaded to avoid
  // infinite reload loops.
  const [lastLoadedEdtUlid, setLastLoadedEdtUlid] = useState<string | null>(null);

  useEffect(() => {
    if (focusedEdt && edtActionLogStatus === 'idle' && focusedEdt.ulid !== lastLoadedEdtUlid) {
      void loadEdtActionLog(focusedEdt.ulid);
      setLastLoadedEdtUlid(focusedEdt.ulid);
    }
  }, [focusedEdt, edtActionLogStatus, loadEdtActionLog, lastLoadedEdtUlid]);

  // Each dialog's submit/input-handling logic lives in its own file under dialogs/ — these
  // factories close over this render's values (the deps object is recreated every render).
  const { handleSwitchDialogInput, dispatchResolutionDecision, startSwitch } = createSwitchDialogHandlers({
    setDialog,
    switchEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    setCurrentEdtAction,
    focusedEdt,
    switchDirtyRepos,
    resolveSwitchDirtyRepos,
  });
  // Once the core switch parks on the dirty-repo seam, open the resolution view on a fresh draft —
  // the outgoing EDT is the store's active one (null on a first switch) — and load each state-2/3
  // repo's local branch list once (listMemberBranches, via the store), for the advisory "already
  // exists" check. Keyed on primitives, never on the dialog object.
  const switchResolutionDraftCounter = useRef(0);
  const switchResolutionNeeded = dialog.kind === 'switch-confirm' && switchDirtyRepos !== null && dialog.resolution === null;
  useEffect(() => {
    if (!switchResolutionNeeded || switchDirtyRepos === null) {
      return;
    }
    const dirty = switchDirtyRepos;
    const outgoingTopic = activeEdtUlid !== null ? (edtsRows.find((entry) => entry.ulid === activeEdtUlid)?.topic ?? null) : null;
    // Branches other EDTs register per repo, so a row sitting on one is retargeted to the global
    // name and such a name is rejected inline.
    const claims = otherEdtBranches(edtsRows, activeEdtUlid);
    // Each draft is tagged, so a late list load from an earlier attempt never lands in a newer
    // draft; a rejected load settles as 'error', never stuck 'loading'.
    switchResolutionDraftCounter.current += 1;
    const draftId = switchResolutionDraftCounter.current;
    setDialog((prev) =>
      prev.kind === 'switch-confirm' && prev.resolution === null
        ? { ...prev, resolution: initialSwitchResolution(outgoingTopic, dirty, claims, draftId) }
        : prev,
    );
    for (const repo of resolutionRepos(dirty)) {
      const repoPath = repo.repoPath;
      const apply = (list: LocalBranchList) => {
        setDialog((prev) => {
          if (
            prev.kind !== 'switch-confirm' ||
            prev.resolution === null ||
            prev.resolution.draftId !== draftId ||
            prev.resolution.lists[repoPath]?.status !== 'loading'
          ) {
            return prev;
          }
          return { ...prev, resolution: { ...prev.resolution, lists: { ...prev.resolution.lists, [repoPath]: list } } };
        });
      };
      listBranchesAction(repoPath).then(
        (result) => apply(result.ok ? { status: 'ready', branches: result.data } : { status: 'error', branches: [] }),
        () => apply({ status: 'error', branches: [] }),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchResolutionNeeded]);

  // The resolution view's decision (raised inside its key reducer) resumes the parked core switch
  // here, outside any state updater.
  const switchResolutionDecision = dialog.kind === 'switch-confirm' ? (dialog.resolution?.decision ?? null) : null;
  useEffect(() => {
    if (switchResolutionDecision !== null && dialog.kind === 'switch-confirm') {
      dispatchResolutionDecision(dialog);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchResolutionDecision]);

  const { handleCreateInput, loadPendingBranchLists, handleCancelRequest, dispatchActivationDecision } = createCreateWizardHandlers({
    setDialog,
    createEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    requestQuit,
    setCurrentEdtAction,
    focusedEdt,
    edtsRows,
    candidates,
    listCreateBranches: listCreateBranchesAction,
    activateEdtAction,
    // "Switch now" hands off to the switch dialog on the new EDT, resolved from the store's `edts`
    // the wizard just reloaded (this render's `edtsRows` predates the create).
    startSwitch: (created) => {
      const target = useStore.getState().edts?.find((entry) => entry.ulid === created.ulid);
      if (target === undefined) {
        // The reload failed: the EDT exists but cannot be switched to from here.
        setDialog((prev) =>
          prev.kind === 'create'
            ? {
                ...prev,
                submitting: false,
                error: `EDT « ${created.topic} » créé, mais introuvable après rechargement — basculez-y depuis la liste des EDT.`,
                activation: { ...prev.activation, created, outcome: 'not-activated' },
              }
            : prev,
        );
        void logEdtAction(
          created.ulid,
          'create',
          'failed',
          `Created EDT "${created.topic}" — not activated: not found after reloading the EDT list, the switch was not run`,
        );
        return;
      }
      startSwitch(target);
    },
  });

  // A decision Step 4's key reducer raised (retry / overwrite / stop) runs here, outside any state
  // updater — the same pattern as the switch resolution view's decision.
  const activationDecision = dialog.kind === 'create' ? dialog.activation.decision : null;
  useEffect(() => {
    if (activationDecision !== null && dialog.kind === 'create') {
      dispatchActivationDecision(dialog);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activationDecision]);

  // Entering the create wizard's Step 3 queues every service whose lists are not loaded yet (or
  // failed last time) as `pending`; this effect hands them to the wizard, which flips them to
  // `loading` at once — so each service is loaded once per entry. Keyed on the joined pending
  // paths (a primitive), never on the dialog object itself.
  const pendingCreateListPaths =
    dialog.kind === 'create'
      ? Object.entries(dialog.branches.lists)
          .filter(([, lists]) => lists.status === 'pending')
          .map(([path]) => path)
          .sort()
          .join('\n')
      : '';
  useEffect(() => {
    if (pendingCreateListPaths !== '') {
      loadPendingBranchLists(pendingCreateListPaths.split('\n'));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingCreateListPaths]);

  // Step 3 decides an Esc-cancel against the latest state inside its updater and raises
  // `cancelRequested`; the cancel's side effects (close / quit) run here.
  const createCancelRequested = dialog.kind === 'create' && dialog.cancelRequested;
  useEffect(() => {
    if (createCancelRequested) {
      handleCancelRequest();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createCancelRequested]);

  function openEdtAction() {
    const target = edtsRows[clampedEdtsSelected];
    if (target === undefined) {
      return;
    }
    if (activeEdtUlid !== null && target.ulid === activeEdtUlid) {
      setDialog(initialModifyDialog(target));
    } else {
      setDialog(initialSwitchDialog(target));
    }
  }

  const { handleModifyDialogInput } = createModifyDialogHandlers({
    setDialog,
    modifyEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    setCurrentEdtAction,
    createMemberBranchAction,
    renameBranchAction,
    focusedEdt,
    candidates,
  });
  const { handleServiceActionsInput } = createServiceActionsDialogHandlers({
    setDialog,
    modifyEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    createMemberBranchAction,
    candidates,
  });
  const { handleAddToEdtInput } = createAddToEdtDialogHandlers({
    setDialog,
    modifyEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    createMemberBranchAction,
    renameBranchAction,
  });
  const { handleDeleteDialogInput, loadMemberStatuses } = createDeleteDialogHandlers({
    setDialog,
    deleteEdtAction,
    resolveMemberDeleteStatusesAction,
    loadEdts,
    loadEdtsBranches,
    setCurrentEdtAction,
  });
  const { handleQuickPickDialogInput } = createQuickPickDialogHandlers({
    setDialog,
    setCurrentEdtAction,
    edtsRows,
    activeEdtUlid,
  });

  // Fetches the delete-confirm dialog's per-member merge/clean statuses once, when it opens with
  // memberRows === null — never for a `rejected` dialog (nothing to disposition). Keyed on
  // primitives (ulid + a loading/loaded flag), like the branch-picker effect above: a fresh
  // `dialog` object on every keystroke must never re-trigger this fetch.
  const deleteDialogTargetUlid = dialog.kind === 'delete-confirm' && !dialog.rejected ? dialog.target.ulid : null;
  const deleteDialogNeedsStatuses = dialog.kind === 'delete-confirm' && !dialog.rejected && dialog.memberRows === null;
  useEffect(() => {
    if (deleteDialogTargetUlid === null || !deleteDialogNeedsStatuses) {
      return;
    }
    const current = dialog as DeleteDialogState;
    void loadMemberStatuses(current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deleteDialogTargetUlid, deleteDialogNeedsStatuses]);

  useInput((input, key) => {
    if (dialog.kind === 'create') {
      handleCreateInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'switch-confirm') {
      handleSwitchDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'modify') {
      handleModifyDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'service-actions') {
      handleServiceActionsInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'add-to-edt') {
      handleAddToEdtInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'delete-confirm') {
      handleDeleteDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'quick-pick') {
      handleQuickPickDialogInput(dialog, input, key);
      return;
    }
    if (dialog.kind === 'issues') {
      // Read-only dialog, no submit path — Esc or Enter both just close it.
      if (key.escape || key.return) {
        setDialog({ kind: 'none' });
      }
      return;
    }

    // Base edt-list view (no dialog open): Tab cycles which of the three lists is focused;
    // arrows/Home/End move only the currently-focused list — all three stay independently
    // navigable.
    const paneStep = resolveFocusStep(input, key, PANE_FOCUS_NAV.mode);
    if (paneStep !== null) {
      setPaneFocus((current) => cyclePaneFocus(current, paneStep));
      return;
    }

    // Opens the issues detail dialog from any pane, like the summary line's "[i] details" hint —
    // only reachable when there's actually something to show.
    if (input === 'i' && issuesSummary !== null) {
      setDialog(initialIssuesDialog());
      return;
    }

    if (paneFocus === 'edts') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setEdtsSelected(jumpSelection(jump, edtsRows.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setEdtsSelected((prevIndex) => moveSelection(prevIndex, direction, edtsRows.length));
        return;
      }
      if (key.return) {
        openEdtAction();
      }
      return;
    }

    if (paneFocus === 'edt-services') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setEdtServicesSelected(jumpSelection(jump, edtServices.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setEdtServicesSelected((prevIndex) => moveSelection(prevIndex, direction, edtServices.length));
        return;
      }
      if (key.return) {
        const service = edtServices[clampedEdtServicesSelected];
        if (service !== undefined && focusedEdt !== undefined) {
          setDialog(initialServiceActionsDialog(focusedEdt, service.path, service.service));
        }
      }
      return;
    }

    // paneFocus === 'other-services'
    const jump = resolveSelectionJump(key);
    if (jump !== null) {
      setOtherServicesSelected(jumpSelection(jump, otherServices.length));
      return;
    }
    const direction = resolveSelectionDirection(key);
    if (direction !== null) {
      setOtherServicesSelected((prevIndex) => moveSelection(prevIndex, direction, otherServices.length));
      return;
    }
    if (key.return) {
      const service = otherServices[clampedOtherServicesSelected];
      if (service !== undefined && focusedEdt !== undefined) {
        setDialog(initialAddToEdtDialog(focusedEdt, service.path, service.service, service.branch, service.sharedBranch));
      }
    }
  // While Ctrl+W resize-mode owns input (AppShell's useInput dispatches Tab/arrows/Enter/Esc to
  // the store directly — see app-shell.tsx), this zone's own Tab/arrow/Enter handling goes inert
  // too, as it does under the other three overlays.
  }, { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resetScreenOpen && !resizeMode });

  const loading = status === 'loading' && rows.length === 0;
  const edtsLoading = edtsStatus === 'loading' && edts === null;

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ZoneLayout
        zoneId="edts"
        useStore={useStore}
        first={
          <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            {/* The list column's 3 fixed-but-movable regions — EDTS, EDT SERVICES, OTHER
                SERVICES — are nested ZoneLayouts: boundary 1 splits EDTS vs. the rest; boundary 2
                splits the rest into EDT SERVICES vs. OTHER SERVICES. */}
            <ZoneLayout
              zoneId="edts"
              boundary={1}
              useStore={useStore}
              first={
              <>
              <Text color={paneFocus === 'edts' ? colors.accent : colors['text-dim']}>EDTS</Text>
              {edtsLoading ? <Text color={colors['text-dim']}>Loading EDTs…</Text> : null}
              {edtsStatus === 'error' ? <Text color={colors.error}>Failed to load EDTs</Text> : null}
              {!edtsLoading && edtsStatus !== 'error' && edtsRows.length === 0 ? (
                <Text color={colors['text-dim']}>No EDTs yet.</Text>
              ) : null}
              {edtsRows.map((entry, index) => (
                <ListRow
                  key={entry.ulid}
                  label={entry.topic}
                  meta={formatEdtRowMeta(entry)}
                  selected={paneFocus === 'edts' && index === clampedEdtsSelected}
                  // `emphasized` marks the row at `clampedEdtsSelected` — the index `focusedEdt`
                  // (below) is read from, whose membership drives the EDT SERVICES/OTHER SERVICES
                  // split — so it persists across all three panes' focus, unlike `selected`.
                  emphasized={index === clampedEdtsSelected}
                  // `active`: the tool-wide active EDT's row, a discreet suffix rather than
                  // accent+bold — decoupled from `emphasized`, so it can land on the same or a
                  // different row.
                  active={entry.ulid === activeEdtUlid}
                />
              ))}
              {!dialogOpen ? <DimAnnotation text="[Enter] switch/modify  [Tab] focus" /> : null}
              </>
              }
              second={
              <>
              {/* The services list is split into two Tab-cyclable panes, partitioned against the
                  *selected* EDT's membership — a "No EDT selected" note stands in for EDT
                  SERVICES when no EDT is focused. */}
              {/* issuesSummary counts unreachable/error services across the whole list, so it
                  shows once here, above both groups, never nested under one where a flagged
                  service in the other would go unreported. */}
              {loading ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
              {status === 'error' ? <Text color={colors.error}>Failed to load services</Text> : null}
              {/* Colored by severity (not the uniform dim gray of other DimAnnotation lines) so a
                  listing problem is noticed, not skimmed past — plus an `[i] details` hint into
                  the read-only issues dialog. */}
              {issuesSummary ? (
                <Box paddingLeft={2}>
                  <Text color={issuesSeverity === 'error' ? colors.error : colors.warning} bold>
                    {issuesSeverity === 'error' ? '✖' : '▲'} {issuesSummary}
                    {!dialogOpen ? '  [i] details' : ''}
                  </Text>
                </Box>
              ) : null}

              <ZoneLayout
                zoneId="edts"
                boundary={2}
                useStore={useStore}
                first={
                <>
                {focusedEdt !== undefined ? (
                  <>
                    <Text color={paneFocus === 'edt-services' ? colors.accent : colors['text-dim']}>EDT SERVICES</Text>
                    {!loading && status !== 'error' && edtServices.length === 0 ? (
                      <Text color={colors['text-dim']}>No services in this EDT.</Text>
                    ) : null}
                    {/* Bounded to edtServicesMaxVisibleRows — only the rendered window, never the
                        content/selection/action semantics. */}
                    <BoundedList
                      items={edtServices}
                      maxVisibleRows={edtServicesMaxVisibleRows}
                      cursorIndex={paneFocus === 'edt-services' ? clampedEdtServicesSelected : undefined}
                      renderItem={(service, index) => (
                        <ListRow
                          key={service.path}
                          label={service.service}
                          meta={formatServiceMeta(service)}
                          selected={paneFocus === 'edt-services' && index === clampedEdtServicesSelected}
                        />
                      )}
                    />
                  </>
                ) : (
                  <DimAnnotation text="No EDT selected" />
                )}
                </>
                }
                second={
                <>
                <Text color={paneFocus === 'other-services' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
                {!loading && status !== 'error' && otherServices.length === 0 ? (
                  <Text color={colors['text-dim']}>No managed services found.</Text>
                ) : null}
                {/* Bounded to otherServicesMaxVisibleRows. */}
                <BoundedList
                  items={otherServices}
                  maxVisibleRows={otherServicesMaxVisibleRows}
                  cursorIndex={paneFocus === 'other-services' ? clampedOtherServicesSelected : undefined}
                  renderItem={(service, index) => (
                    <ListRow
                      key={service.path}
                      label={service.service}
                      meta={formatServiceMeta(service)}
                      selected={paneFocus === 'other-services' && index === clampedOtherServicesSelected}
                    />
                  )}
                />
                </>
                }
              />
              </>
              }
            />
          </Box>
        }
        second={
          <Box flexDirection="column" minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            {paneFocus === 'edts' ? (
              <>
                <DetailPane title={focusedEdt ? focusedEdt.topic : 'EDT'}>
                  {focusedEdt
                    ? formatEdtDetail(focusedEdt, focusedEdt.ulid === activeEdtUlid) +
                      '\n\n' +
                      formatEdtActionHistory(edtActionLog, currentEdtAction, hiddenActionTypes) +
                      appendHint(resolveActionHint('edts', focusedEdt.ulid === activeEdtUlid, hiddenActionHints))
                    : 'No EDT selected.'}
                </DetailPane>
                {edtsStatus === 'error' && edtsError ? <DimAnnotation text={edtsError} /> : null}
                {edtActionLogStatus === 'loading' && <DimAnnotation text="Loading action history…" />}
                {edtActionLogStatus === 'error' && <DimAnnotation text="Failed to load action history" />}
              </>
            ) : paneFocus === 'edt-services' ? (
              <>
                <DetailPane title={focusedEdtService ? focusedEdtService.service : 'Service'}>
                  {(focusedEdtService ? formatServiceDetail(focusedEdtService) : 'No service selected.') +
                    appendHint(resolveActionHint('edt-services', false, hiddenActionHints))}
                </DetailPane>
                {focusedEdtService?.detail ? <DimAnnotation text={focusedEdtService.detail.message} /> : null}
                {status === 'error' && error ? <DimAnnotation text={error} /> : null}
              </>
            ) : (
              <>
                <DetailPane title={focusedOtherService ? focusedOtherService.service : 'Service'}>
                  {(focusedOtherService ? formatServiceDetail(focusedOtherService) : 'No service selected.') +
                    appendHint(resolveActionHint('other-services', false, hiddenActionHints))}
                </DetailPane>
                {focusedOtherService?.detail ? <DimAnnotation text={focusedOtherService.detail.message} /> : null}
                {status === 'error' && error ? <DimAnnotation text={error} /> : null}
              </>
            )}
          </Box>
        }
      />

      {dialog.kind === 'create' ? (
        <CreateWizardView
          dialog={dialog}
          candidates={candidates}
          candidateState={candidateState}
          edtsRows={edtsRows}
          maxRows={branchDropdownMaxRows}
          maxVisibleRows={createWizardTableMaxRows}
        />
      ) : null}

      {dialog.kind === 'switch-confirm' ? <SwitchDialogView dialog={dialog} switchDirtyRepos={switchDirtyRepos} maxVisibleRows={switchResolutionMaxRows} /> : null}

      {dialog.kind === 'modify' ? <ModifyDialogView dialog={dialog} candidates={candidates} candidateState={candidateState} maxRows={branchDropdownMaxRows} /> : null}

      {dialog.kind === 'service-actions' ? <ServiceActionsDialogView dialog={dialog} maxRows={branchDropdownMaxRows} /> : null}

      {dialog.kind === 'add-to-edt' ? <AddToEdtDialogView dialog={dialog} maxRows={branchDropdownMaxRows} /> : null}

      {dialog.kind === 'delete-confirm' ? <DeleteDialogView dialog={dialog} /> : null}

      {dialog.kind === 'quick-pick' ? (
        <QuickPickDialogView dialog={dialog} pool={resolveQuickPickCandidates(dialog.mode, edtsRows, activeEdtUlid)} />
      ) : null}

      {dialog.kind === 'issues' ? <IssuesDialogView unreachable={unreachable} errors={errors} /> : null}
    </Box>
  );
}
