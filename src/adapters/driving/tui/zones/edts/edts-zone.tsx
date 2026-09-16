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
import { Box, Text, useInput, type Key } from 'ink';
import type { ServiceBranchDivergence } from '../../../../../core/edt/list.js';
import type { EdtRegistryEntry } from '../../../../../core/ports/edt-registry.js';
import { DEFAULT_BASE_BRANCH, useAppStore, type AppStore } from '../../store/app-store.js';
import { CheckboxListItem } from '../../shared/components/checkbox-list-item.js';
import { TextInputLine } from '../../shared/components/text-input-line.js';
import { BranchPicker, handleBranchPickerKey, type BranchPickerOutcome } from '../../shared/components/branch-picker.js';
import { DetailPane } from '../../shared/components/detail-pane.js';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import { FailedResultList } from '../../shared/components/failed-result-list.js';
import { ListDetailSplit, resolveSplitFlex } from '../../shared/components/list-detail-split.js';
import { ListRow } from '../../shared/components/list-row.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';
import { Splitter } from '../../shared/components/splitter.js';
import { colors, spacing } from '../../shared/theme/theme.js';
import {
  appendHint,
  canEditMemberBranch,
  createPickerSession,
  cycleFormFocus,
  cyclePaneFocus,
  findRetryableFailedRow,
  formatEdtActionHistory,
  formatEdtDetail,
  formatEdtRowMeta,
  formatIssuesSummary,
  formatServiceDetail,
  formatServiceMeta,
  initialAddToEdtDialog,
  initialCreateDialog,
  initialModifyDialog,
  initialServiceActionsDialog,
  initialSwitchDialog,
  jumpSelection,
  moveSelection,
  nextTextInputValue,
  partitionServicesByEdtMembership,
  type PaneFocus,
  resolveActionHint,
  resolveCandidateListState,
  resolveModifyEnterAction,
  resolveModifyOps,
  resolveSelectionDirection,
  resolveSelectionJump,
  suggestBranchForNewMember,
  suggestBranchNameFromTopic,
  summarizeFailedResults,
  toggleMemberSelection,
  validateBranchEditValue,
  type BranchPickerSession,
  type EdtDialogState,
  type ModifyDialogState,
} from './edts-zone.logic.js';
import { createAddToEdtDialogHandlers, AddToEdtDialogView } from './dialogs/add-to-edt-dialog.js';
import { createCreateDialogHandlers, CreateDialogView } from './dialogs/create-dialog.js';
import { createServiceActionsDialogHandlers, ServiceActionsDialogView } from './dialogs/service-actions-dialog.js';
import { createSwitchDialogHandlers, SwitchDialogView } from './dialogs/switch-dialog.js';

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
  initialDialogKind?: 'create' | 'switch-confirm' | 'switch-blocked' | 'modify' | 'service-actions' | 'add-to-edt';
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
  const modifyEdtAction = useStore((state) => state.modifyEdt);
  // Story 2.26: the shared branch-picker's own store actions (Design Notes: `deps.git` is
  // still never touched directly from this zone — these wrap core/edt/modify.ts's
  // listMemberBranches/createMemberBranch/renameMemberBranch exports).
  const listBranchesAction = useStore((state) => state.listBranches);
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
      return initialAddToEdtDialog(target, svc.path, svc.service, svc.branch);
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
  // session opens (any of the 3 entry points, via createPickerSession's branchesStatus:
  // 'loading' seed) — never re-fetched on every render, mirroring loadEdtsBranches' own
  // "fetched on the relevant change, not continuously re-synced" convention. A stale response
  // (the picker closed, or a different repoPath's session opened, before this resolved) is
  // dropped rather than applied.
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
          // No topic specified - the dialog will show quick-pick (handled by switch dialog logic)
          // For now, open switch-confirm for the first non-active EDT
          const nonActiveEdt = edtsRows.find((e) => e.ulid !== activeEdtUlid);
          if (nonActiveEdt) {
            setDialog(initialSwitchDialog(nonActiveEdt));
            setCurrentEdtAction(null);
          } else {
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
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
          // No topic specified - open modify for the focused EDT
          if (focusedEdt) {
            setDialog(initialModifyDialog(focusedEdt));
            setCurrentEdtAction(null);
          } else {
            setDialog({ kind: 'none' });
            setCurrentEdtAction(null);
          }
        }
      }
    }
  }, [currentEdtAction, dialog.kind, edtsRows, activeEdtUlid, focusedEdt, setDialog, setCurrentEdtAction]);

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
  const { handleSwitchDialogInput } = createSwitchDialogHandlers({
    setDialog,
    switchEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    setCurrentEdtAction,
    focusedEdt,
  });
  const { handleCreateInput } = createCreateDialogHandlers({
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
  });

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

  async function submitModify(current: ModifyDialogState) {
    if (current.submitting) {
      return;
    }
    // Story 2.24: block confirm inline (no core call) when a newly-checked member's staged
    // branch is empty — same validateBranchEditValue convention the branch-edit sub-dialog
    // already uses for its own Enter, just enforced here too since a new member's field can be
    // reached and cleared without ever opening that sub-dialog.
    const originalPaths = new Set(current.target.members.map((member) => member.repoPath));
    for (const path of current.selectedMembers) {
      if (!originalPaths.has(path)) {
        const validationError = validateBranchEditValue(current.branchEdits[path] ?? '');
        if (validationError !== null) {
          setDialog((prev) => (prev.kind === 'modify' ? { ...prev, error: validationError } : prev));
          return;
        }
      }
    }
    const ops = resolveModifyOps(current.target, current.topic, current.selectedMembers, current.branchEdits, current.branchRenames);
    setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: true, error: null, failedRows: [] } : prev));
    const result = await modifyEdtAction({ topic: current.target.topic, ...ops });
    if (result.ok) {
      void loadEdts();
      void loadEdtsBranches();
      // Story 2.25: structured rows — note `current.branchEdits`/`branchRenames` (read by
      // openBranchPickerForModify below) are never cleared on failure, so a "try a different
      // branch"/"try a different name" retry on one of these rows naturally reopens pre-filled
      // with the value that just got rejected.
      const failedRows = summarizeFailedResults(result.data.results);
      if (failedRows.length > 0) {
        setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: false, failedRows } : prev));
        // Log failed action
        if (focusedEdt) {
          await logEdtAction(focusedEdt.ulid, 'modify', 'failed', failedRows.map((row) => row.message).join('; '));
        }
        return;
      }
      setDialog({ kind: 'none' });
      // Log successful action
      if (focusedEdt) {
        const changes: string[] = [];
        if (ops.addMembers.length > 0) changes.push(`added ${ops.addMembers.length} member(s)`);
        if (ops.removeMembers.length > 0) changes.push(`removed ${ops.removeMembers.length} member(s)`);
        // Story 2.24 code review: resolveModifyOps now always includes a setBranches entry
        // for every checked non-member (i.e. every add) — only count an entry toward "changed
        // N branch(es)" when it's NOT also one of the adds, so a plain add with no other
        // change never double-logs as a branch change too.
        const addPaths = new Set(ops.addMembers);
        const actualBranchChanges = ops.setBranches.filter((entry) => !addPaths.has(entry.repoPath));
        if (actualBranchChanges.length > 0) changes.push(`changed ${actualBranchChanges.length} branch(es)`);
        if (ops.renameBranches.length > 0) changes.push(`renamed ${ops.renameBranches.length} branch(es)`);
        if (ops.renameTo) changes.push(`renamed to "${ops.renameTo}"`);
        const detail = changes.length > 0 ? changes.join(', ') : 'no changes';
        await logEdtAction(focusedEdt.ulid, 'modify', 'success', detail);
      }
    } else {
      setDialog((prev) => (prev.kind === 'modify' ? { ...prev, submitting: false, error: result.error.message } : prev));
      // Log failed action
      if (focusedEdt) {
        await logEdtAction(focusedEdt.ulid, 'modify', 'failed', result.error.message);
      }
    }
  }

  // Story 2.26: opens the shared branch-picker over `repoPath`, replacing the old free-text
  // branch-edit sub-dialog. `hasCurrentBranch`/`currentBranch` come from this EDT's own
  // membership — an existing member offers Rename current (pre-selected onto its own branch);
  // a not-yet-member candidate (newly checked in the checklist) never does (Boundaries).
  function openBranchPickerForModify(
    current: ModifyDialogState,
    repoPath: string,
    options: { retry?: { field: 'create-name' | 'rename'; value: string; oldName?: string }; autoSubmitOnConfirm?: boolean } = {},
  ) {
    const member = current.target.members.find((candidate) => candidate.repoPath === repoPath);
    const hasCurrentBranch = member !== undefined;
    const currentBranch = member?.branch ?? '';
    const suggestion =
      current.branchEdits[repoPath] ?? current.branchRenames[repoPath] ?? currentBranch ?? suggestBranchForNewMember(current.target.members, current.topic);
    const session = createPickerSession(repoPath, {
      suggestedName: suggestion,
      hasCurrentBranch,
      currentBranch,
      retry: options.retry,
      autoSubmitOnConfirm: options.autoSubmitOnConfirm,
    });
    setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchPicker: session } : prev));
  }

  // Story 2.26: applies a confirmed BranchPickerOutcome for Modify's per-member step. Unlike
  // service-actions/add-to-edt (immediate submit), Modify only *stages* the result — other
  // members may still need checking/unchecking before the whole form is submitted — except
  // when this session was opened by the "try a different name"/"try a different branch" retry
  // action, which re-runs submitModify immediately (Boundaries: "confirming re-runs the same
  // submit function ... not a full-dialog restart").
  //
  // 'rename' on an *existing* member stages into branchRenames only (modifyEdt's renameBranches
  // step alone both renames the ref and records the new branch — no checkout needed, so
  // branchEdits must never also carry it, or step 3's setBranches would try to check out a
  // branch that doesn't exist by the old name any more before step 4 has renamed it). 'rename'
  // on a not-yet-member candidate has no "current registered branch" for modifyEdt's own
  // renameBranches step to resolve (it isn't a member yet) — so it's applied eagerly here via a
  // direct renameMemberBranch pre-step, then staged into branchEdits like any other setBranches
  // target (a real checkout is still needed for a brand-new member).
  async function stageModifyBranchPickerOutcome(current: ModifyDialogState, repoPath: string, outcome: BranchPickerOutcome) {
    const session = current.branchPicker;
    const autoSubmit = session?.autoSubmitOnConfirm ?? false;

    const finish = (branchEdits: Record<string, string>, branchRenames: Record<string, string>) => {
      setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchEdits, branchRenames, branchPicker: null } : prev));
      if (autoSubmit) {
        void submitModify({ ...current, branchEdits, branchRenames, branchPicker: null });
      }
    };
    const fail = (message: string) => {
      setDialog((prev) =>
        prev.kind === 'modify' && prev.branchPicker !== null
          ? { ...prev, branchPicker: { ...prev.branchPicker, state: { ...prev.branchPicker.state, error: message } } }
          : prev,
      );
    };
    // branchEdits/branchRenames are siblings that must never both carry the same repoPath (see
    // the field comments above) — staging into one always clears any stale entry in the other,
    // so re-opening the picker for the same repo and staging a different-kind outcome can't
    // leave both maps populated for it.
    const withoutRepoPath = (record: Readonly<Record<string, string>>): Record<string, string> => {
      if (!(repoPath in record)) {
        return record;
      }
      const next = { ...record };
      delete next[repoPath];
      return next;
    };

    if (outcome.kind === 'set') {
      finish({ ...current.branchEdits, [repoPath]: outcome.branch }, withoutRepoPath(current.branchRenames));
      return;
    }
    if (outcome.kind === 'create') {
      const created = await createMemberBranchAction(repoPath, outcome.branchName, outcome.baseBranch);
      if (!created.ok) {
        fail(created.error.message);
        return;
      }
      finish({ ...current.branchEdits, [repoPath]: outcome.branchName }, withoutRepoPath(current.branchRenames));
      return;
    }
    // outcome.kind === 'rename'
    const isExistingMember = current.target.members.some((member) => member.repoPath === repoPath);
    if (isExistingMember) {
      finish(withoutRepoPath(current.branchEdits), { ...current.branchRenames, [repoPath]: outcome.newName });
      return;
    }
    const renamed = await renameBranchAction(repoPath, outcome.oldName, outcome.newName);
    if (!renamed.ok) {
      fail(renamed.error.message);
      return;
    }
    finish({ ...current.branchEdits, [repoPath]: outcome.newName }, withoutRepoPath(current.branchRenames));
  }

  function handleModifyBranchPickerInput(current: ModifyDialogState, session: BranchPickerSession, input: string, key: Key) {
    const otherMemberBranches = Array.from(new Set(current.target.members.map((member) => member.branch)));
    const result = handleBranchPickerKey(session.state, session.branches, otherMemberBranches, input, key);
    if (result.type === 'cancel') {
      setDialog((prev) => (prev.kind === 'modify' ? { ...prev, branchPicker: null } : prev));
      return;
    }
    if (result.type === 'submit') {
      void stageModifyBranchPickerOutcome(current, session.repoPath, result.outcome);
      return;
    }
    setDialog((prev) =>
      prev.kind === 'modify' && prev.branchPicker !== null ? { ...prev, branchPicker: { ...prev.branchPicker, state: result.state } } : prev,
    );
  }

  function handleModifyDialogInput(current: ModifyDialogState, input: string, key: Key) {
    if (current.branchPicker !== null) {
      handleModifyBranchPickerInput(current, current.branchPicker, input, key);
      return;
    }
    // Story 2.25/2.26: "try a different branch"/"try a different name" — an Enter while a
    // failedRows row carries a registered action reopens the branch picker over that repoPath
    // (openBranchPickerForModify), pre-filled from the value that just got rejected. Confirming
    // it re-runs submitModify via stageModifyBranchPickerOutcome's autoSubmit path, never a
    // full-dialog restart. Takes priority over the form's other Enter handling below
    // (topic-edit resubmit, members-list nav dispatch) whenever a resolvable failure is
    // showing, since retrying it is the only sensible next step.
    if (key.return && !current.submitting) {
      const retryRow = findRetryableFailedRow(current.failedRows);
      if (retryRow !== undefined) {
        const repoPath =
          candidates.find((candidate) => candidate.service === retryRow.service)?.path ??
          current.target.members.find((member) => member.service === retryRow.service)?.repoPath;
        if (repoPath !== undefined) {
          // branchEdits/branchRenames are mutually exclusive per repoPath (see
          // stageModifyBranchPickerOutcome) — a populated branchRenames entry means the failed
          // attempt was a 'rename' outcome, so retry must reopen onto the rename field (not
          // Create-new, which would try to *create* a branch instead of renaming one).
          const failedRename = current.branchRenames[repoPath];
          const retry =
            failedRename !== undefined
              ? {
                  field: 'rename' as const,
                  value: failedRename,
                  oldName: current.target.members.find((member) => member.repoPath === repoPath)?.branch,
                }
              : { field: 'create-name' as const, value: current.branchEdits[repoPath] ?? '' };
          openBranchPickerForModify(current, repoPath, {
            retry,
            autoSubmitOnConfirm: true,
          });
          return;
        }
      }
    }
    if (key.tab) {
      setDialog((prev) => (prev.kind === 'modify' ? { ...prev, formFocus: cycleFormFocus(prev.formFocus) } : prev));
      return;
    }
    if (key.escape) {
      if (!current.submitting) {
        setDialog({ kind: 'none' });
        setCurrentEdtAction(null);
      }
      return;
    }
    if (current.formFocus === 'members') {
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setDialog((prev) => (prev.kind === 'modify' ? { ...prev, memberCursor: jumpSelection(jump, candidates.length) } : prev));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setDialog((prev) =>
          prev.kind === 'modify' ? { ...prev, memberCursor: moveSelection(prev.memberCursor, direction, candidates.length) } : prev,
        );
        return;
      }
      if (input === ' ') {
        const path = candidates[current.memberCursor]?.path;
        if (path !== undefined) {
          setDialog((prev) => {
            if (prev.kind !== 'modify') {
              return prev;
            }
            const nextSelected = toggleMemberSelection(prev.selectedMembers, path);
            // Story 2.24: newly checking a not-yet-member candidate auto-stages a suggested
            // branch (never overwriting one already staged, e.g. from an earlier check/edit/
            // uncheck/re-check round-trip) so the mandatory-branch confirm guard below always
            // has something real to validate instead of a silent default.
            const isNewlyChecked = !prev.selectedMembers.includes(path) && nextSelected.includes(path);
            const isNotYetMember = !prev.target.members.some((member) => member.repoPath === path);
            const nextBranchEdits =
              isNewlyChecked && isNotYetMember && prev.branchEdits[path] === undefined
                ? { ...prev.branchEdits, [path]: suggestBranchForNewMember(prev.target.members, prev.topic) }
                : prev.branchEdits;
            return { ...prev, selectedMembers: nextSelected, branchEdits: nextBranchEdits };
          });
        }
        return;
      }
      if (key.return) {
        const path = candidates[current.memberCursor]?.path;
        const action = resolveModifyEnterAction('members', current.selectedMembers, path);
        if (action.type === 'edit-branch') {
          openBranchPickerForModify(current, action.repoPath);
        } else {
          void submitModify(current);
        }
        return;
      }
      return;
    }
    // formFocus === 'topic'
    if (key.return) {
      void submitModify(current);
      return;
    }
    setDialog((prev) => (prev.kind === 'modify' ? { ...prev, topic: nextTextInputValue(prev.topic, input, key) } : prev));
  }

  const { handleServiceActionsInput } = createServiceActionsDialogHandlers({
    setDialog,
    modifyEdtAction,
    loadEdts,
    loadEdtsBranches,
    logEdtAction,
    createMemberBranchAction,
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

    // Base edt-list view (no dialog open): Tab cycles which of the three lists is focused;
    // arrows/Home/End move only the currently-focused list — all three stay independently
    // navigable.
    if (key.tab) {
      setPaneFocus((current) => cyclePaneFocus(current));
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
        setDialog(initialAddToEdtDialog(focusedEdt, service.path, service.service, service.branch));
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
              {issuesSummary ? <DimAnnotation text={issuesSummary} /> : null}

              <Box flexDirection="column" flexGrow={resolveSplitFlex(ratio[2]).list} flexBasis={0} minHeight={0} overflow="hidden">
                {focusedEdt !== undefined ? (
                  <>
                    <Text color={paneFocus === 'edt-services' ? colors.accent : colors['text-dim']}>EDT SERVICES</Text>
                    {!loading && status !== 'error' && edtServices.length === 0 ? (
                      <Text color={colors['text-dim']}>No services in this EDT.</Text>
                    ) : null}
                    {edtServices.map((service, index) => (
                      <ListRow
                        key={service.path}
                        label={service.service}
                        meta={formatServiceMeta(service)}
                        selected={paneFocus === 'edt-services' && index === clampedEdtServicesSelected}
                      />
                    ))}
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
                {otherServices.map((service, index) => (
                  <ListRow
                    key={service.path}
                    label={service.service}
                    meta={formatServiceMeta(service)}
                    selected={paneFocus === 'other-services' && index === clampedOtherServicesSelected}
                  />
                ))}
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

      {dialog.kind === 'create' ? <CreateDialogView dialog={dialog} candidates={candidates} candidateState={candidateState} /> : null}

      {dialog.kind === 'switch-confirm' ? <SwitchDialogView dialog={dialog} /> : null}

      {dialog.kind === 'modify' ? (
        <ModalDialog title="MODIFY EDT" onConfirm={() => {}} onCancel={() => {}} open={true}>
          <Box flexDirection="column">
            {dialog.branchPicker !== null ? (
              <BranchPicker
                state={dialog.branchPicker.state}
                branches={dialog.branchPicker.branches}
                branchesStatus={dialog.branchPicker.branchesStatus}
                otherMemberBranches={Array.from(new Set(dialog.target.members.map((member) => member.branch)))}
              />
            ) : (
              <>
                <TextInputLine label="Topic" value={dialog.topic} focused={dialog.formFocus === 'topic'} />
                {candidateState === 'loading' ? <Text color={colors['text-dim']}>Loading services…</Text> : null}
                {candidateState === 'empty' ? <Text color={colors['text-dim']}>No registered services available.</Text> : null}
                {candidateState === 'ready'
                  ? candidates.map((candidate, index) => {
                      const branch = dialog.branchRenames[candidate.path] ?? dialog.branchEdits[candidate.path] ??
                        dialog.target.members.find((member) => member.repoPath === candidate.path)?.branch;
                      return (
                        <Box key={candidate.path}>
                          <Text color={colors.accent}>{dialog.formFocus === 'members' && index === dialog.memberCursor ? '›' : ' '}</Text>
                          <CheckboxListItem
                            label={candidate.service}
                            state={dialog.selectedMembers.includes(candidate.path) ? 'checked' : 'unchecked'}
                            meta={branch}
                          />
                        </Box>
                      );
                    })
                  : null}
                {dialog.failedRows.length > 0 ? <FailedResultList rows={dialog.failedRows} /> : dialog.error ? <DimAnnotation text={dialog.error} /> : null}
                {dialog.submitting ? <DimAnnotation text="Saving…" /> : null}
              </>
            )}
          </Box>
        </ModalDialog>
      ) : null}

      {dialog.kind === 'service-actions' ? <ServiceActionsDialogView dialog={dialog} /> : null}

      {dialog.kind === 'add-to-edt' ? <AddToEdtDialogView dialog={dialog} /> : null}
    </Box>
  );
}
