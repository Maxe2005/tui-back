// tui/zones/edts: story 2.6 (FR-9) shipped the flat, ungrouped service/divergence list.
// Story 2.9 layers an EDT selector (list of EDTs + create/switch/modify) above it, driving
// core/edt/{create,switch,modify}.ts in-process (AD-2) via the store's createEdt/switchEdt/
// modifyEdt actions — never shelling out to the CLI. Story 2.6's flat list stays exactly as
// it was: both lists are independently keyboard-navigable, arbitrated by Tab-cycled pane
// focus (default: the EDT selector) rather than one replacing or freezing the other.
//
// Component boundary note (UX-DR17): DetailPane wraps its `children` in a single Ink <Text>
// internally, so only Text-safe content (a joined string, not nested <Box>) goes through it;
// a per-service git-error `detail.message` is rendered as a DimAnnotation *sibling* of
// DetailPane, never nested inside it and never inlined into the ListRow itself.
//
// Design Notes (this story): no shared navigation/form hook exists — every keystroke
// behavior (text-input editing, checkbox toggle, Tab-cycle target, list nav, pane-focus
// toggle, the create/switch/modify submit-op derivation) is a standalone pure function,
// unit-tested directly; the `useInput` callback stays a thin dispatcher over them, following
// the same split resolveSelectionDirection/moveSelection already established in story 2.6/2.7.
//
// This file holds the Ink component only — the pure formatting/selection/form-focus logic
// and the 5 dialogs' state shapes/initializers live in edts-zone.logic.ts (kept in one place
// so the component here stays scannable; see that file's own header for why).
import { useEffect, useState } from 'react';
import { Box, Text, useInput, useWindowSize, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { useAppStore, type AppStore } from '../../store/app-store.js';
import { BoundedList } from '../../shared/components/bounded-list.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { ListDetailSplit, resolveSplitFlex } from '../../shared/components/list-detail-split.js';
import { ListRow } from '../../shared/components/list-row.js';
import { Splitter } from '../../shared/components/splitter.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  appendHint,
  cyclePaneFocus,
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
import { autoStashedRepos, initialSwitchResolution, resolutionRepos } from './dialogs/switch-resolution/switch-resolution.logic.js';

// Story 5.5: rough terminal-chrome budget (top bar, zone-tab bar, footer, the EDTS pane above
// the splitter, both section headers, and the loading/error/issues lines) subtracted from the
// raw window size before either service list's own BoundedList ever sees it — mirrors
// logs-zone.tsx's own CHROME_ROWS ("an approximation is fine here").
const EDTS_SERVICE_LISTS_CHROME_ROWS = 12;
// Story 2.37: rows the create wizard spends around Step 3's Panel B table — modal border and
// title, breadcrumb, intro, Panel A (title + 2 lines + a field's edit hint), Panel B title and
// column header, the blocked-row detail line, Step 3 footer, error line and the wizard footer.
// An approximation, as above.
const CREATE_WIZARD_CHROME_ROWS = 17;
// Story 2.41: rows the switch resolution view spends around its Panel B table — modal border
// and title, the (wrapping) intro, Panel A (title + 2 lines + the no-outgoing note), Panel B
// title and column header, the blocked-row detail, the Ctrl+N error, the list-loading note and
// the footer. The read-only state-1 rows below the table are added on top. An approximation.
const SWITCH_RESOLUTION_CHROME_ROWS = 17;

export function EdtsZone({
  useStore = useAppStore,
  // Test-only injection point (mirrors `useStore` above): `renderToString`'s fake stdin
  // never emits a real keypress (documented repo-wide), so a smoke test can't Tab its way
  // to the SERVICES pane to assert its detail-pane content. Production always starts on the
  // spec-mandated default ('edts' — the EDT selector).
  initialPaneFocus = 'edts',
  // Test-only injection point: `renderToString` performs one synchronous render-then-unmount
  // pass (render-to-string.ts) and never observes a *second*, effect-triggered commit — so a
  // smoke test can't rely on the real "zero EDTs auto-opens the create dialog" effect (AC1)
  // to have already run by the time output is captured. The real-keypress interaction tests
  // (edts-zone.interaction.test.tsx) already exercise that effect end-to-end through a real
  // Ink render loop; this prop only seeds the same initial state a renderToString smoke test
  // needs. Production always starts with no dialog open.
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
  // Story 2.21: splitterRatios.edts is now a 3-entry array — boundary 0 (index 0) drives the
  // existing list<->detail split below; boundaries 1/2 drive the list column's own two
  // sub-splits (EDTS<->rest, EDT SERVICES<->OTHER SERVICES — Design Notes).
  const ratio = useStore((state) => state.splitterRatios.edts);
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
  const switchEdtAction = useStore((state) => state.switchEdt);
  // Bug fix: the switch dirty-repo confirm seam (edt-slice.ts).
  const switchDirtyRepos = useStore((state) => state.switchDirtyRepos);
  const resolveSwitchDirtyRepos = useStore((state) => state.resolveSwitchDirtyRepos);
  const modifyEdtAction = useStore((state) => state.modifyEdt);
  const deleteEdtAction = useStore((state) => state.deleteEdt);
  const resolveMemberDeleteStatusesAction = useStore((state) => state.resolveMemberDeleteStatuses);
  // Story 2.26: the shared branch-picker's own store actions (Design Notes: `deps.git` is
  // still never touched directly from this zone — these wrap core/edt/modify.ts's
  // listMemberBranches/createMemberBranch/renameMemberBranch exports).
  const listBranchesAction = useStore((state) => state.listBranches);
  // Story 2.37: the create wizard's Step 3 per-service lists (local + remote-tracking refs).
  const listCreateBranchesAction = useStore((state) => state.listCreateBranches);
  const createMemberBranchAction = useStore((state) => state.createMemberBranch);
  const renameBranchAction = useStore((state) => state.renameBranch);
  const setZoneInputCaptured = useStore((state) => state.setZoneInputCaptured);
  const requestQuit = useStore((state) => state.requestQuit);
  // Story 2.14 review fix: Ink dispatches every keypress to every mounted `useInput` hook
  // regardless of z-order, so without this gate Tab/Enter typed into the `:` command bar
  // would also silently fire this zone's own pane-focus toggle / openEdtAction() underneath
  // it (Spec Change Log, spec-2-14).
  const commandBarOpen = useStore((state) => state.commandBarOpen);
  // Story 2.19 review fix (confirmed in real usage): the same leakage applies to the registry
  // and settings screens — both are overlays rendered on top of this zone while it stays
  // mounted underneath, so without this gate Left/Right/Tab/Up/Down typed into either popup
  // also silently drove this zone's own pane focus/list-cursor/dialogs at the same time.
  const registryScreenOpen = useStore((state) => state.registryScreenOpen);
  const settingsScreenOpen = useStore((state) => state.settingsScreenOpen);
  // Story 2.15: EDT action state for detail pane — tracks in-progress action and action log
  const currentEdtAction = useStore((state) => state.currentEdtAction);
  const setCurrentEdtAction = useStore((state) => state.setCurrentEdtAction);
  const edtActionLog = useStore((state) => state.edtActionLog);
  const edtActionLogStatus = useStore((state) => state.edtActionLogStatus);
  const loadEdtActionLog = useStore((state) => state.loadEdtActionLog);
  const logEdtAction = useStore((state) => state.logEdtAction);
  // Story 2.19: hides a per-context action hint immediately from the detail pane once toggled
  // in the settings screen's EDTs tab.
  const hiddenActionHints = useStore((state) => state.settings.edts.hiddenActionHints);
  const hiddenActionTypes = useStore((state) => state.settings.edts.hiddenActionTypes);
  // The shared branch autocomplete's visible row cap — threaded into every BranchPicker
  // session's pick-existing filter (no per-service override, no new setting of its own).
  const branchDropdownMaxRows = useStore((state) => state.settings.edts.branchDropdownMaxRows);

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its
    // own; an explicit refresh action is a later story's concern (Design Notes: "refreshed
    // on-demand ... not cached indefinitely").
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Review patch: a reload that fails *after* a successful load previously left `services`
  // (now stale) in place while `edtsBranchesStatus` flipped to 'error' — the zone rendered
  // the stale row list and the "Failed to load services" banner at once, which is
  // misleading and breaks the "never a stale value" principle this story applies everywhere
  // else (no-upstream/unknown-offline). An error state now shows only the error — never the
  // rows or the detail pane content that would otherwise still reference them.
  const rows = status === 'error' ? [] : (services ?? []);
  // Same "never a stale value on error" gating as `rows` above.
  const issuesSummary = status === 'error' ? null : formatIssuesSummary(unreachable.length, errors.length);
  // Story 2.34: same gating as issuesSummary above — never a stale severity color on a load
  // error either.
  const issuesSeverity = status === 'error' ? null : resolveIssuesSeverity(unreachable.length, errors.length);

  // Story 2.9 -----------------------------------------------------------------------------
  const [paneFocus, setPaneFocus] = useState<PaneFocus>(initialPaneFocus);
  const [edtsSelected, setEdtsSelected] = useState(0);
  // Story 2.18: the flat SERVICES pane's single cursor is now two independent cursors, one
  // per partitioned pane (EDT SERVICES / OTHER SERVICES) — each keeps its own position as
  // paneFocus cycles between them, same as edtsSelected already does for the EDT selector.
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
      // Test-only seed (mirrors 'create'/'issues' above): defaults to switch mode — a
      // renderToString smoke test only needs one representative mode's chrome to render;
      // real per-mode coverage (filter/arrow-nav/select/no-match/Esc across all 3 modes) goes
      // through the real-keypress interaction tests, driving the actual currentEdtAction ->
      // quick-pick effect below instead of this seed.
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
      // Review fix (story 2.29) test-only seed: one row carries a statusError (mirrors the
      // shape resolveMemberDeleteStatuses returns when a manifest/git read fails) so
      // formatDeleteMemberMeta's "(status unknown — defaulted to leave)" annotation has real
      // rendering coverage, not just a pure-function unit test.
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

  // Story 2.18: the flat SERVICES list, partitioned against the *selected* EDT's membership —
  // each half is its own independently arrow/Home/End-navigable pane.
  const { edtServices, otherServices } = partitionServicesByEdtMembership(rows, focusedEdt);
  const clampedEdtServicesSelected = edtServices.length === 0 ? 0 : Math.min(edtServicesSelected, edtServices.length - 1);
  const clampedOtherServicesSelected = otherServices.length === 0 ? 0 : Math.min(otherServicesSelected, otherServices.length - 1);
  const focusedEdtService: ServiceBranchDivergence | undefined = edtServices[clampedEdtServicesSelected];
  const focusedOtherService: ServiceBranchDivergence | undefined = otherServices[clampedOtherServicesSelected];

  // Story 5.5 (OVERFLOW_EDTS_LISTS): same unbounded-list corruption pattern as the Logs zone,
  // confirmed by inspection — EDT SERVICES/OTHER SERVICES render every row with no cap. A rough
  // total-rows budget for this zone's whole list column (top bar, zone-tab bar, footer, the
  // EDTS pane above the splitter, both section headers, and the loading/error/issues lines)
  // mirrors logs-zone.tsx's own CHROME_ROWS precedent ("an approximation is fine here") rather
  // than a precise splitter-ratio measurement — this only adds a rendering-level bound around
  // existing rows (Never: EDT SERVICES/OTHER SERVICES' own content/selection/action semantics
  // stay untouched). Handed out top-down (EDT SERVICES first, OTHER SERVICES the remainder) so
  // a short EDT SERVICES list leaves more room for OTHER SERVICES.
  const windowSize = useWindowSize();
  const servicesListsAvailableHeight = Math.max(windowSize.rows - EDTS_SERVICE_LISTS_CHROME_ROWS, 4);
  // Story 2.37 (NFR-7): the create wizard's Step 3 table budget, same live pattern as above.
  const createWizardTableMaxRows = Math.max(windowSize.rows - CREATE_WIZARD_CHROME_ROWS, 3);
  // Story 2.41 (NFR-7): the switch resolution table / discard file-list budget, same pattern.
  const switchResolutionMaxRows = Math.max(
    windowSize.rows - SWITCH_RESOLUTION_CHROME_ROWS - (switchDirtyRepos !== null ? autoStashedRepos(switchDirtyRepos).length : 0),
    3,
  );
  const edtServicesMaxVisibleRows = servicesListsAvailableHeight;
  // Review fix: an empty EDT SERVICES list still renders a 1-row placeholder ("No services in
  // this EDT.") instead of the BoundedList's own 0 rows — `Math.min(edtServices.length, …)` was
  // 0 for an empty list, under-counting what that section actually consumes and leaving OTHER
  // SERVICES 1 row over budget.
  const edtServicesConsumedRows = edtServices.length === 0 ? 1 : Math.min(edtServices.length, edtServicesMaxVisibleRows);
  const otherServicesMaxVisibleRows = Math.max(1, servicesListsAvailableHeight - edtServicesConsumedRows);

  // Review fix (story 2.18): arrowing within the `edts` pane changes `focusedEdt` — and
  // therefore the contents of both partitioned service panes — without touching either pane's
  // own cursor. Left un-reset, a cursor could silently land on a row unrelated to the newly
  // selected EDT (e.g. row 2 of the old EDT SERVICES list happens to still be in range for the
  // new one, but is a completely different service). Reset both to the top whenever which EDT
  // is selected changes.
  useEffect(() => {
    setEdtServicesSelected(0);
    setOtherServicesSelected(0);
  }, [focusedEdt?.ulid]);

  const dialogOpen = dialog.kind !== 'none';

  // AC1: no EDT exists -> an explicit create prompt (topic input + member checklist),
  // never a bare/empty list. Auto-opens once the list has genuinely resolved to empty
  // (never while still loading, never on a load error — mirrors the flat list's own
  // "never render on a stale/unknown state" rule).
  useEffect(() => {
    if (edtsStatus === 'idle' && edts !== null && edts.length === 0 && dialog.kind === 'none') {
      setDialog(initialCreateDialog());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edtsStatus, edts]);

  // Boundary: gate app-shell's global shortcuts (help/filter/command/zone-mnemonic/quit)
  // while any dialog here owns the keystroke.
  useEffect(() => {
    setZoneInputCaptured(dialogOpen);
  }, [dialogOpen, setZoneInputCaptured]);
  useEffect(() => () => setZoneInputCaptured(false), [setZoneInputCaptured]);

  // Story 2.26: fetches a branch-picker session's own listBranches(repoPath) once, whenever a
  // session opens (any of the entry points, via createPickerSession's branchesStatus:
  // 'loading' seed) — never re-fetched on every render, mirroring loadEdtsBranches' own
  // "fetched on the relevant change, not continuously re-synced" convention. A stale response
  // (the picker closed, or a different repoPath's session opened, before this resolved) is
  // dropped rather than applied.
  // Story 2.37: the create wizard no longer opens a picker session — its Step 3 lists load
  // through the wizard's own loadPendingBranchLists (effect below).
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

  // Story 2.15: handle command-triggered dialogs via currentEdtAction state.
  // When a command sets currentEdtAction, open the corresponding dialog.
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
          // Story 2.30: no topic specified — open the quick-pick (switch mode) instead of
          // guessing "the first non-active EDT". The picker's own Enter handler opens this
          // exact initialSwitchDialog(target) once a topic is actually chosen.
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
          // Story 2.30: no topic specified — open the quick-pick (modify mode), filtering
          // every EDT (active included), instead of guessing "the focused row".
          setDialog(initialQuickPickDialog('modify'));
          setCurrentEdtAction(null);
        }
      } else if (currentEdtAction.type === 'delete') {
        // Boundary: "The active EDT can never be deleted ... reject before any git/file
        // write." initialDeleteDialog itself enforces this at open time (isActive param) —
        // the dialog still opens for an active target, just showing the rejection message
        // (never auto-switched, per the same Boundary).
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
          // Story 2.30: no topic specified — open the quick-pick (delete mode), filtering
          // every EDT (active included). Selecting the active EDT there still opens the
          // existing rejection dialog (initialDeleteDialog's own isActive check, unchanged) —
          // just reached via the picker instead of the focused-row fallback.
          setDialog(initialQuickPickDialog('delete'));
          setCurrentEdtAction(null);
        }
      }
    }
  }, [currentEdtAction, dialog.kind, edtsRows, activeEdtUlid, setDialog, setCurrentEdtAction]);

  // Story 2.15: load action log when an EDT row is focused
  // Track which EDT we've loaded to avoid infinite reload loops
  const [lastLoadedEdtUlid, setLastLoadedEdtUlid] = useState<string | null>(null);

  useEffect(() => {
    if (focusedEdt && edtActionLogStatus === 'idle' && focusedEdt.ulid !== lastLoadedEdtUlid) {
      void loadEdtActionLog(focusedEdt.ulid);
      setLastLoadedEdtUlid(focusedEdt.ulid);
    }
  }, [focusedEdt, edtActionLogStatus, loadEdtActionLog, lastLoadedEdtUlid]);

  // Story 2.26 refactor: each dialog's own submit/input-handling logic lives in its own file
  // under dialogs/ (see edts-zone.tsx's header) — these factories close over this render's own
  // values (deps object recreated every render, same as the handlers it replaces were), so
  // behavior is unchanged; only the code's location moved.
  const { handleSwitchDialogInput, dispatchResolutionDecision } = createSwitchDialogHandlers({
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
  // Story 2.41: once the core switch parks on the dirty-repo seam, open the resolution view on
  // a fresh draft — the outgoing EDT is the store's active one (null on a first switch) — and
  // load each state-2/3 repo's local branch list once (listMemberBranches, via the store), for
  // the advisory "already exists" check. Keyed on primitives, never on the dialog object.
  const switchResolutionNeeded = dialog.kind === 'switch-confirm' && switchDirtyRepos !== null && dialog.resolution === null;
  useEffect(() => {
    if (!switchResolutionNeeded || switchDirtyRepos === null) {
      return;
    }
    const dirty = switchDirtyRepos;
    const outgoingTopic = activeEdtUlid !== null ? (edtsRows.find((entry) => entry.ulid === activeEdtUlid)?.topic ?? null) : null;
    setDialog((prev) =>
      prev.kind === 'switch-confirm' && prev.resolution === null ? { ...prev, resolution: initialSwitchResolution(outgoingTopic, dirty) } : prev,
    );
    for (const repo of resolutionRepos(dirty)) {
      const repoPath = repo.repoPath;
      void listBranchesAction(repoPath).then((result) => {
        setDialog((prev) => {
          if (prev.kind !== 'switch-confirm' || prev.resolution === null || prev.resolution.lists[repoPath]?.status !== 'loading') {
            return prev;
          }
          const list = result.ok ? { status: 'ready' as const, branches: result.data } : { status: 'error' as const, branches: [] };
          return { ...prev, resolution: { ...prev.resolution, lists: { ...prev.resolution.lists, [repoPath]: list } } };
        });
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchResolutionNeeded]);

  // Story 2.41: the resolution view's decision (raised inside its key reducer) resumes the
  // parked core switch here, outside any state updater.
  const switchResolutionDecision = dialog.kind === 'switch-confirm' ? (dialog.resolution?.decision ?? null) : null;
  useEffect(() => {
    if (switchResolutionDecision !== null && dialog.kind === 'switch-confirm') {
      dispatchResolutionDecision(dialog);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [switchResolutionDecision]);

  const { handleCreateInput, loadPendingBranchLists, handleCancelRequest } = createCreateWizardHandlers({
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
  });

  // Story 2.37: entering the create wizard's Step 3 queues every service whose lists are not
  // loaded yet (or failed last time) as `pending`; this effect hands them to the wizard, which
  // flips them to `loading` at once — so each service is loaded once per entry. Keyed on the
  // joined pending paths (a primitive), never on the dialog object itself.
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

  // Story 2.37 (review): Step 3 decides an Esc-cancel against the latest state inside its
  // updater and raises `cancelRequested`; the cancel's side effects (close / quit) run here.
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

  // Story 2.29: fetches the delete-confirm dialog's own per-member merge/clean statuses once,
  // when it opens with memberRows === null (mirrors the branch-picker fetch effect above) —
  // never fired for a `rejected` dialog (nothing to disposition there). Keyed on primitives
  // (ulid + a loading/loaded flag), not the dialog object itself, for the same reason the
  // branch-picker effect above is: a fresh `dialog` object on every keystroke must never
  // re-trigger this fetch.
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
    if (key.tab) {
      setPaneFocus((current) => cyclePaneFocus(current));
      return;
    }

    // Story 2.34: opens the issues detail dialog from any pane, mirroring the summary line's
    // own "[i] details" hint — only reachable when there's actually something to show.
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
  // Story 2.21: while Ctrl+W resize-mode owns input (AppShell's own useInput dispatches
  // Tab/arrows/Enter/Esc to the store directly — see app-shell.tsx), this zone's own Tab/
  // arrow/Enter handling must go inert too, the same way it already does under the other
  // three overlays.
  }, { isActive: !commandBarOpen && !registryScreenOpen && !settingsScreenOpen && !resizeMode });

  const loading = status === 'loading' && rows.length === 0;
  const edtsLoading = edtsStatus === 'loading' && edts === null;

  return (
    <Box flexDirection="column" flexGrow={1} backgroundColor={colors.surface}>
      <ListDetailSplit
        ratio={ratio[0]}
        listSplitterTargeted={resizeMode?.zone === 'edts' && resizeMode.targetBoundary === 0}
        list={
          <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden" paddingX={spacing['pane-padding-x']}>
            {/* Story 2.21: the list column's own 3 fixed-but-movable regions — EDTS,
                EDT SERVICES, OTHER SERVICES — each a sub-Box separated by a horizontal
                Splitter, sized off splitterRatios.edts[1]/[2] (Design Notes: boundary 1 splits
                EDTS vs. the "rest" below it; boundary 2 splits that rest into EDT SERVICES vs.
                OTHER SERVICES). `targeted` recolors whichever boundary Ctrl+W resize-mode
                currently has selected, read off the same store flag AppShell's own useInput
                dispatches against (Boundaries: "one store flag ... so AppShell's global gate
                and EdtsZone's own useInput check the same source"). */}
            {/* Bugfix (post-2.21 human review): every flexGrow box below also carries
                `flexBasis={0} minHeight={0} overflow="hidden"` — without it, a pane's default
                minimum size is its own content size (Yoga/CSS "min-size: auto"), so e.g. a long
                EDTS list would grow past its ratio share and drag the EDTS/EDT-SERVICES
                boundary down with it, exactly the "position moves with content volume" bug the
                fixed-but-Ctrl+W-movable contract forbids. Verified empirically (0 to 100+ rows
                of content, boundary position unchanged) before applying here. */}
            <Box flexDirection="column" flexGrow={resolveSplitFlex(ratio[1]).list} flexBasis={0} minHeight={0} overflow="hidden">
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
                  // Amended 2026-08-27 (Sprint Change Proposal): `emphasized` now marks the row
                  // at `clampedEdtsSelected` — the same index `focusedEdt` (below) is read from,
                  // whose membership drives the EDT SERVICES/OTHER SERVICES split — so it persists
                  // across all three panes' focus, not just while paneFocus === 'edts' (unlike
                  // `selected` above).
                  emphasized={index === clampedEdtsSelected}
                  // `active` (repurposed): the tool-wide active EDT's row, now a discreet suffix
                  // instead of accent+bold — decoupled from `emphasized`, can land on the same or
                  // a different row.
                  active={entry.ulid === activeEdtUlid}
                />
              ))}
              {!dialogOpen ? <DimAnnotation text="[Enter] switch/modify  [Tab] focus" /> : null}
            </Box>

            <Splitter
              orientation="horizontal"
              size={1}
              targeted={resizeMode?.zone === 'edts' && resizeMode.targetBoundary === 1}
            />

            <Box flexDirection="column" flexGrow={resolveSplitFlex(ratio[1]).detail} flexBasis={0} minHeight={0} overflow="hidden">
              {/* Story 2.18: the flat SERVICES list (story 2.6) is now split into two
                  Tab-cyclable panes, partitioned against the *selected* EDT's own membership
                  (partitionServicesByEdtMembership) — never an empty EDT SERVICES group when no
                  EDT is focused; a "No EDT selected" note stands in for it instead. */}
              {/* Review fix (story 2.18): issuesSummary counts unreachable/error services across
                  the whole flat list, which may include rows that land in either partitioned
                  group — shown once here, above both groups, rather than nested only under
                  OTHER SERVICES where a flagged service that's actually an EDT member would go
                  unreported. */}
              {loading ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
              {status === 'error' ? <Text color={colors.error}>Failed to load services</Text> : null}
              {/* Story 2.34: colored by severity (never the uniform dim gray every other
                  DimAnnotation line uses) so a listing problem is noticed, not skimmed past —
                  plus an `[i] details` hint into the read-only issues dialog. */}
              {issuesSummary ? (
                <Box paddingLeft={2}>
                  <Text color={issuesSeverity === 'error' ? colors.error : colors.warning} bold>
                    {issuesSeverity === 'error' ? '✖' : '▲'} {issuesSummary}
                    {!dialogOpen ? '  [i] details' : ''}
                  </Text>
                </Box>
              ) : null}

              <Box flexDirection="column" flexGrow={resolveSplitFlex(ratio[2]).list} flexBasis={0} minHeight={0} overflow="hidden">
                {focusedEdt !== undefined ? (
                  <>
                    <Text color={paneFocus === 'edt-services' ? colors.accent : colors['text-dim']}>EDT SERVICES</Text>
                    {!loading && status !== 'error' && edtServices.length === 0 ? (
                      <Text color={colors['text-dim']}>No services in this EDT.</Text>
                    ) : null}
                    {/* Story 5.5 (OVERFLOW_EDTS_LISTS): bounded to edtServicesMaxVisibleRows —
                        content/selection/action semantics unchanged, only the rendered window. */}
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
              </Box>

              <Splitter
                orientation="horizontal"
                size={1}
                targeted={resizeMode?.zone === 'edts' && resizeMode.targetBoundary === 2}
              />

              <Box flexDirection="column" flexGrow={resolveSplitFlex(ratio[2]).detail} flexBasis={0} minHeight={0} overflow="hidden">
                <Text color={paneFocus === 'other-services' ? colors.accent : colors['text-dim']}>OTHER SERVICES</Text>
                {!loading && status !== 'error' && otherServices.length === 0 ? (
                  <Text color={colors['text-dim']}>No managed services found.</Text>
                ) : null}
                {/* Story 5.5 (OVERFLOW_EDTS_LISTS): bounded to otherServicesMaxVisibleRows. */}
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
              </Box>
            </Box>
          </Box>
        }
        detail={
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
