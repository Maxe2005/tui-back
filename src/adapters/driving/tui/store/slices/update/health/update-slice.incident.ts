// tui/store/slices: the Update slice's incident queue — raising a blocker or a `shared-types`
// phase failure as an incident, and the popup/toast/resolve actions that answer it.
import { SHARED_TYPES_PHASE_FAILED } from '../../../../../../../core/workspace/shared-types/consumers/smart-update.js';
import type { UpdateBlockerChoice } from '../../../../../../../core/workspace/scripts/group-update/group-update.js';
import {
  appendLiveIssue,
  type IncidentBlocker,
  type SharedTypesPhaseBlocker,
  type UpdateIncident,
  type UpdateSlice,
  type UpdateSliceContext,
  type UpdateSliceGet,
  type UpdateSliceSet,
} from '../update-slice.types.js';

export function createRaiseIncident(
  ctx: UpdateSliceContext,
  set: UpdateSliceSet,
): (blocker: IncidentBlocker) => Promise<UpdateBlockerChoice> {
  const { incidentResolvers, raisedKinds } = ctx;
  // Raises one incident in the queue and waits for the developer's choice. Shared by core's
  // blocker seam and the `shared-types` phase failure: the first incident opens the popup when
  // the developer is in the Update zone, later ones never steal focus (a toast names them).
  function raiseIncident(blocker: IncidentBlocker): Promise<UpdateBlockerChoice> {
    ctx.incidentSequence += 1;
    const id = `incident-${ctx.incidentSequence}`;
    const stillBlocked = raisedKinds.get(blocker.service) === blocker.kind;
    raisedKinds.set(blocker.service, blocker.kind);
    const reason = 'retryReason' in blocker ? blocker.retryReason : undefined;
    const incident: UpdateIncident = {
      id,
      blocker,
      raisedAt: Date.now(),
      ...(stillBlocked
        ? { stillBlocked: { reason: blocker.kind === SHARED_TYPES_PHASE_FAILED ? (blocker as SharedTypesPhaseBlocker).message : (reason ?? 'Re-verification failed — the repo is still blocked') } }
        : {}),
    };
    return new Promise<UpdateBlockerChoice>((resolveChoice) => {
      incidentResolvers.set(id, resolveChoice);
      set((state) => {
        const first = state.incidents.length === 0;
        const popupOpensNow = first && state.activeZone === 'update';
        return {
          incidents: [...state.incidents, incident],
          incidentPopupOpen: popupOpensNow ? true : state.incidentPopupOpen,
          incidentToast: popupOpensNow ? state.incidentToast : `${blocker.service} needs you (${blocker.kind})`,
          // A resolved entry re-raised stays unresolved; only a fresh service appends.
          liveServiceIssues: stillBlocked
            ? state.liveServiceIssues
            : appendLiveIssue(state.liveServiceIssues, blocker.service, {
                kind: blocker.kind,
                detail:
                  blocker.kind === SHARED_TYPES_PHASE_FAILED
                    ? (blocker as SharedTypesPhaseBlocker).message
                    : blocker.kind === 'unpushed-commits'
                      ? `${blocker.branch ?? ''}: ${(blocker.commits ?? []).join(' | ')}`
                      : blocker.kind === 'merge-conflict' && blocker.autoResolveNote !== undefined
                        ? `${blocker.repoPath} — ${blocker.autoResolveNote}`
                        : blocker.repoPath,
                resolved: false,
              }),
        };
      });
    });
  }

  return raiseIncident;
}

export function createUpdateIncidentActions(
  ctx: UpdateSliceContext,
  set: UpdateSliceSet,
  get: UpdateSliceGet,
): Pick<
  UpdateSlice,
  | 'incidents'
  | 'incidentPopupOpen'
  | 'incidentToast'
  | 'resolveUpdateIncident'
  | 'openIncidentPopup'
  | 'closeIncidentPopup'
  | 'clearIncidentToast'
> {
  const { incidentResolvers } = ctx;
  return {
    incidents: [],
    incidentPopupOpen: false,
    incidentToast: null,
    resolveUpdateIncident: (id: string, choice: UpdateBlockerChoice) => {
      const resolveChoice = incidentResolvers.get(id);
      if (resolveChoice === undefined) {
        return;
      }
      incidentResolvers.delete(id);
      if (choice === 'cancel-run') {
        // Cancelling the whole run closes every other pending incident as cancelled; core
        // stops unstarted services and finishes in-flight ones at their step boundary.
        const others = [...incidentResolvers.entries()];
        incidentResolvers.clear();
        set({ incidents: [], incidentPopupOpen: false, incidentToast: null });
        resolveChoice(choice);
        for (const [, otherResolve] of others) {
          otherResolve('cancel-run');
        }
        return;
      }
      set((state) => {
        const incidents = state.incidents.filter((incident) => incident.id !== id);
        return {
          incidents,
          incidentPopupOpen: incidents.length === 0 ? false : state.incidentPopupOpen,
          incidentToast: incidents.length === 0 ? null : state.incidentToast,
        };
      });
      resolveChoice(choice);
    },
    openIncidentPopup: () => {
      if (get().incidents.length > 0) {
        set({ incidentPopupOpen: true });
      }
    },
    closeIncidentPopup: () => set({ incidentPopupOpen: false }),
    clearIncidentToast: () => set({ incidentToast: null }),
  };
}
