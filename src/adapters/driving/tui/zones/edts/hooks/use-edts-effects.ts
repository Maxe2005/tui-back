// tui/zones/edts: use-edts-effects — the zone's lifecycle effects, first half, in their original
// declaration order (mount load, cursor reset, footer context, auto-open create, input-capture
// flag, branch-picker fetch, command-triggered dialogs, action-log load).
import { useEffect, useRef, useState } from 'react';
import { isSystemEdt } from '../../../../../../core/workspace/edt/shared-edt/shared-edt.js';
import { branchOwnersMap } from '../../../../../../core/workspace/edt/branches/branch-owners.js';
import { useFooterContext } from '../../../shared/hooks/use-footer-context.js';
import { edtsFooterContext } from '../logic/edts-footer-context.js';
import {
  initialCreateDialog,
  initialDeleteDialog,
  initialModifyDialog,
  initialQuickPickDialog,
  initialSwitchDialog,
  SYSTEM_EDT_NOTICE,
} from '../logic/edts-zone.logic.js';
import type { EdtRegistryEntry } from '../../../../../../core/ports/storage/edt-registry.js';
import type { EdtsZoneCtx } from '../edts-zone.ctx.js';

export function useEdtsEffects(c: EdtsZoneCtx): void {
  const {
    useStore,
    loadEdtsBranches,
    loadEdts,
    edts,
    edtsStatus,
    edtsRows,
    edtsSelected,
    setEdtsSelected,
    setReadonlyNotice,
    userEdtCount,
    systemEdtFooter,
    focusedEdt,
    activeEdtUlid,
    switchDirtyRepos,
    dialog,
    dialogOpen,
    setDialog,
    setEdtServicesSelected,
    setOtherServicesSelected,
    setZoneInputCaptured,
    listBranchesAction,
    currentEdtAction,
    setCurrentEdtAction,
    edtActionLogStatus,
    loadEdtActionLog,
  } = c;

  useEffect(() => {
    void loadEdtsBranches();
    void loadEdts();
    // Deliberately fires once on mount only — a re-render never re-triggers a fetch of its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Arrowing within the `edts` pane changes `focusedEdt` — and therefore the contents of both
  // partitioned service panes — without touching their cursors, which could then land on a row
  // unrelated to the newly selected EDT. Reset both to the top whenever the selected EDT changes.
  useEffect(() => {
    setEdtServicesSelected(0);
    setOtherServicesSelected(0);
  }, [focusedEdt?.ulid]);

  // A reload can insert or drop the system EDT (the setting toggled), shifting every index:
  // re-anchor the selection on the same EDT by ulid (the clamp covers a vanished one).
  const prevEdtsRef = useRef<readonly EdtRegistryEntry[] | null>(null);
  const edtsSelectedRef = useRef(0);
  useEffect(() => {
    const previous = prevEdtsRef.current;
    if (previous !== null && edts !== null && previous !== edts && previous.length > 0) {
      const anchored = previous[Math.min(edtsSelectedRef.current, previous.length - 1)]?.ulid;
      const index = edts.findIndex((entry) => entry.ulid === anchored);
      if (index >= 0) {
        setEdtsSelected(index);
      }
    }
  }, [edts]);
  useEffect(() => {
    prevEdtsRef.current = edts;
    edtsSelectedRef.current = edtsSelected;
  });

  useFooterContext(
    'edts',
    edtsFooterContext(dialog, { registryEmpty: userEdtCount === 0, resolutionPending: switchDirtyRepos !== null, systemEdt: systemEdtFooter }),
    useStore,
  );

  // No EDT exists -> the create wizard, never a bare/empty list. Auto-opens once the list has
  // genuinely resolved to empty (never while still loading, never on a load error).
  useEffect(() => {
    if (edtsStatus === 'idle' && edts !== null && edts.filter((entry) => !isSystemEdt(entry)).length === 0 && dialog.kind === 'none') {
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
  // its own loadPendingBranchLists (use-edts-dialog-effects.ts).
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
        const listed = result.ok ? result.data : [];
        const editedUlid = prev.kind === 'modify' ? prev.target.ulid : prev.edt.ulid;
        const owners = branchOwnersMap(
          edts ?? [],
          repoPath,
          Array.from(new Set([...listed, prev.branchPicker.state.currentBranch])),
          editedUlid,
        );
        return {
          ...prev,
          branchPicker: { ...prev.branchPicker, branches: listed, owners, branchesStatus: result.ok ? 'ready' : 'error' },
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
          if (targetEdt && isSystemEdt(targetEdt)) {
            setReadonlyNotice(SYSTEM_EDT_NOTICE);
            setCurrentEdtAction(null);
          } else if (targetEdt) {
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
            targetEdt && isSystemEdt(targetEdt)
              ? initialQuickPickDialog('create-from', SYSTEM_EDT_NOTICE)
              : targetEdt
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
          if (targetEdt && isSystemEdt(targetEdt)) {
            setReadonlyNotice(SYSTEM_EDT_NOTICE);
            setCurrentEdtAction(null);
          } else if (targetEdt) {
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
}
