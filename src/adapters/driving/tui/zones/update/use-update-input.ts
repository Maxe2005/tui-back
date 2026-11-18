// tui/zones/update: use-update-input — the zone's single `useInput` dispatcher. The first layer
// that is open owns the keystroke: incident list, incident guided menu, config screen, service
// quick-pick, quit confirm, row-local menu, full-screen report, then the base view (recap, list
// cursor, triggers). Every decision is a pure function; the branch order is the Ink input priority.
import { useInput } from '../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../shared/hooks/use-zone-input-active.js';
import { handleFilterablePickListKey } from '../../shared/components/index.js';
import { resolveMenuKey } from '../../shared/components/menu-list.js';
import { jumpSelection, moveSelection, resolveSelectionDirection, resolveSelectionJump } from '../../shared/keys/list-cursor.js';
import {
  applyReportScroll,
  jumpToFailedStep,
  reportMaxOffset,
  resolveRecapToggle,
  resolveReportKey,
} from './update-zone.logic.js';
import { UPDATE_SERVICE_MENU_ESCAPE, resolveServiceMenuChoice, visibleServiceMenuItems } from './update-service-menu-dialog.js';
import { toServicePickItems } from './update-service-pick-dialog.js';
import { reduceIncidentListKey } from './update-incidents.logic.js';
import { resolveQuitConfirm, resolveUpdateTrigger, shouldConfirmQuit } from './update-zone.resolvers.logic.js';
import { UPDATE_BLOCKER_MENU_ESCAPE, blockerMenuItems } from './update-zone.blockers.logic.js';
import { RECAP_CHROME_ROWS, type UpdateZoneCtx } from './update-zone.ctx.js';

export function useUpdateInput(c: UpdateZoneCtx): void {
  const {
    useStore, incidentListActive, selectedIncidentIndex, incidents, setIncidentIndex, setIncidentMode, closeIncidentPopup,
    updateBlocker, blockerCursor, setBlockerCursor, openInIde, setEditorError, resolveUpdateBlocker, updateConfig,
    configPanels, updateServicePick, pickState, setPickState, closeUpdateServicePick, openUpdateConfig, quitConfirm,
    setQuitConfirm, markUpdateInterrupted, requestQuit, serviceMenu, serviceMenuRestartAvailable, serviceMenuCursor,
    setServiceMenuCursor, setServiceMenu, runServiceRestart, reportService, report, reportLayout, reportBudget,
    reportWidth, reportWrap, setReportWrap, reportOffset, setReportOffset, setReportService, recapActive, updateResults,
    recapCursor, setRecapCursor, windowSize, setRecapActive, servicesStatus, updateStatus, loadEdtsBranches,
    setServiceCursor, serviceRows, openIncidentPopup, focusedServiceRow, reportInputFor, setServiceMenuRestartAvailable,
    describeServiceRestart,
  } = c;
  const zoneInputActive = useZoneInputActive(useStore);
  const openReport = (service: string): boolean => {
    if (!reportInputFor(service).available) {
      return false;
    }
    setReportService(service);
    setReportOffset(0);
    return true;
  };

  useInput(
    (input, key) => {
      // The incident popup owns every keystroke while open — `q` must not open the quit-confirm
      // underneath it. In list mode the arrows pick an incident, Enter opens its guided menu and
      // Esc closes the popup without resolving anything (incidents and services stay paused).
      if (incidentListActive) {
        const step = reduceIncidentListKey(key, selectedIncidentIndex, incidents.length);
        if (step.type === 'move') {
          setIncidentIndex(step.index);
        } else if (step.type === 'open-menu') {
          setIncidentMode('menu');
        } else if (step.type === 'close') {
          closeIncidentPopup();
        }
        return;
      }
      // The guided menu of the selected incident (Esc steps back to the list: resolving is always
      // an explicit choice).
      if (updateBlocker !== null) {
        if (key.escape === true) {
          setIncidentMode('list');
          return;
        }
        const step = resolveMenuKey(key, blockerCursor, blockerMenuItems(updateBlocker.kind, 'branch' in updateBlocker ? updateBlocker.branch : undefined), UPDATE_BLOCKER_MENU_ESCAPE);
        if (step.type === 'move') {
          setBlockerCursor(step.cursor);
        } else if (step.type === 'choose') {
          if (step.choice === 'edited' && updateBlocker.kind !== 'shared-types-phase-failed') {
            // Driving-side editor: spawn the configured command and wait for exit, then
            // report the choice — core re-verifies before resuming (a no-op edit
            // re-presents). An editor that could not be started reports nothing to core:
            // the menu stays open on its error line so another choice can be made.
            const launched = openInIde(updateBlocker.repoPath);
            if (!launched.ok) {
              setEditorError(launched.error.message);
              return;
            }
          }
          resolveUpdateBlocker(step.choice);
        }
        return;
      }
      // While the pre-run configuration screen is open it owns every keystroke — the run starts
      // only through its confirm path, with exactly the confirmed configuration.
      if (updateConfig !== null) {
        configPanels.handleKey(input, key);
        return;
      }
      // While the service quick-pick is open it owns every keystroke — the shared pick reducer
      // interprets it; the zone only acts on its outcome: Enter confirms the highlighted service
      // into a config pre-scoped to it, Esc closes without opening anything.
      if (updateServicePick !== null) {
        const pickItems = toServicePickItems(updateServicePick);
        const result = handleFilterablePickListKey(pickState, pickItems, input, key);
        if (result.type === 'update') {
          // Re-run the reducer against the latest state rather than applying the result
          // computed from `pickState` (this render's snapshot): two keypresses delivered
          // before a re-render (key-repeat) must each build on the previous one.
          setPickState((previous) => {
            const latest = handleFilterablePickListKey(previous, pickItems, input, key);
            return latest.type === 'update' ? latest.state : previous;
          });
          return;
        }
        closeUpdateServicePick();
        if (result.type === 'select') {
          void openUpdateConfig({ service: result.item.value.service, repoPath: result.item.value.repoPath });
        }
        return;
      }
      if (quitConfirm) {
        const decision = resolveQuitConfirm(input, key);
        if (decision === 'confirm') {
          setQuitConfirm(false);
          void markUpdateInterrupted().then(() => requestQuit());
        } else if (decision === 'cancel') {
          setQuitConfirm(false);
        }
        return;
      }
      // While the row-local action menu is open it owns every keystroke — arrows/Home/End move,
      // Enter chooses, Esc cancels. Update routes to the config screen pre-scoped to that single
      // service; clean restart runs the standalone single-service use-case for that repo alone.
      if (serviceMenu !== null) {
        const menuItems = visibleServiceMenuItems(serviceMenuRestartAvailable);
        const step = resolveMenuKey(key, Math.min(serviceMenuCursor, menuItems.length - 1), menuItems, UPDATE_SERVICE_MENU_ESCAPE);
        if (step.type === 'move') {
          setServiceMenuCursor(step.cursor);
        } else if (step.type === 'choose') {
          const action = resolveServiceMenuChoice(step.choice, serviceMenu);
          if (action.type === 'open-config') {
            setServiceMenu(null);
            void openUpdateConfig({ service: action.service, repoPath: action.repoPath });
          } else if (action.type === 'restart') {
            setServiceMenu(null);
            void runServiceRestart(action.repoPath);
          } else {
            setServiceMenu(null);
          }
        }
        return;
      }
      // The full-screen report owns every keystroke (before the recap toggle and the triggers, so
      // `p` and `Esc` keep their report meaning). Scrolling is clamped to what still fills the pane.
      if (reportService !== null && report !== null) {
        const action = resolveReportKey(input, key);
        const budget = reportLayout.current?.rows ?? reportBudget;
        const width = reportLayout.current?.columns ?? reportWidth;
        const maxOffset = reportMaxOffset(report.lines, budget, width, reportWrap);
        if (action === 'close') {
          setReportService(null);
        } else if (action === 'toggle-wrap') {
          const nextWrap = !reportWrap;
          setReportWrap(nextWrap);
          setReportOffset(Math.min(reportOffset, reportMaxOffset(report.lines, budget, width, nextWrap)));
        } else if (action === 'next-failed' || action === 'prev-failed') {
          const target = jumpToFailedStep(report.failedLines, reportOffset, action === 'next-failed' ? 'next' : 'prev');
          if (target !== null) {
            setReportOffset(Math.min(target, maxOffset));
          }
        } else if (action !== null) {
          setReportOffset(applyReportScroll(reportOffset, action, maxOffset, budget));
        }
        return;
      }
      // `Enter` on a failed recap row opens that service's report; other rows do nothing.
      if (recapActive && key.return) {
        const row = updateResults[Math.min(recapCursor, Math.max(0, updateResults.length - 1))];
        if (row !== undefined && row.outcome === 'failed') {
          openReport(row.service);
        }
        return;
      }
      // `Esc` drops service focus onto the last-update recap; an arrow key restores it (the
      // remembered service, unmoved).
      if (recapActive && (key.pageDown || key.pageUp)) {
        const page = Math.max(1, windowSize.rows - RECAP_CHROME_ROWS - 1);
        const last = Math.max(0, updateResults.length - 1);
        setRecapCursor((current) => (key.pageDown ? Math.min(last, current + page) : Math.max(0, current - page)));
        return;
      }
      const recapToggle = resolveRecapToggle(recapActive, key);
      if (recapToggle.handled) {
        setRecapActive(recapToggle.recapActive);
        return;
      }
      if (input === 'R' && servicesStatus === 'error' && updateStatus !== 'running') {
        void loadEdtsBranches();
        return;
      }
      // The service list's own cursor — moves regardless of run state (browsing is harmless
      // mid-run); none of the triggers below use arrow/Home/End.
      const jump = resolveSelectionJump(key);
      if (jump !== null) {
        setServiceCursor(jumpSelection(jump, serviceRows.length));
        return;
      }
      const direction = resolveSelectionDirection(key);
      if (direction !== null) {
        setServiceCursor((current) => moveSelection(current, direction, serviceRows.length));
        return;
      }
      if (input === 'i' && incidents.length > 0) {
        openIncidentPopup();
        return;
      }
      if ((input === 'f' || input === 'F') && focusedServiceRow !== undefined) {
        openReport(focusedServiceRow.service);
        return;
      }
      if (updateStatus === 'running') {
        if (shouldConfirmQuit(input, updateStatus)) {
          setQuitConfirm(true);
        }
        return;
      }
      // `a`/`m`/`p` pre-scope the pre-run configuration screen to every managed repo, the EDT,
      // or the highlighted row; `Enter` opens the row-local action menu — no git/docker action
      // runs before a choice is confirmed through its own path.
      const trigger = resolveUpdateTrigger(input, key, updateStatus);
      if (trigger === 'open-edt-config') {
        void openUpdateConfig('edt');
        return;
      }
      if (trigger === 'open-all-config') {
        void openUpdateConfig('all');
        return;
      }
      if (trigger === 'open-single-config') {
        if (focusedServiceRow !== undefined) {
          void openUpdateConfig({ service: focusedServiceRow.service, repoPath: focusedServiceRow.path });
        }
        return;
      }
      if (trigger === 'open-service-menu') {
        if (focusedServiceRow !== undefined) {
          const target = { service: focusedServiceRow.service, repoPath: focusedServiceRow.path };
          setServiceMenu(target);
          // Offered until the manifest says otherwise — a slow lookup must never hide the
          // row, only a confirmed container-less-without-recipe manifest does.
          setServiceMenuRestartAvailable(true);
          void describeServiceRestart(target.repoPath).then(({ restartAvailable }) => {
            setServiceMenuRestartAvailable(restartAvailable);
          });
        }
      }
    },
    { isActive: zoneInputActive },
  );
}
