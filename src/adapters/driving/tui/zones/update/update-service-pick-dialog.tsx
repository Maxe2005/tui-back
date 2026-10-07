// tui/zones/update: the service pick — the no-argument `:update-service` fallback, a filterable
// list of every managed service rendered through shared/components/filterable-pick-list.tsx.
// This file only owns what is service-specific: turning the store's candidates into pick items,
// and the dialog's title and wording.
import {
  FilterablePickList,
  type FilterablePickItem,
  type FilterablePickListState,
} from '../../shared/components/filterable-pick-list.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';

export const UPDATE_SERVICE_PICK_TITLE = 'UPDATE SERVICE';

export type UpdateServicePickCandidate = { service: string; repoPath: string };

// Keyed by repo path (service names are not guaranteed unique across managed repos), with
// the path as secondary text so path-distinguished duplicate names stay narrowable.
export function toServicePickItems(
  candidates: readonly UpdateServicePickCandidate[],
): FilterablePickItem<UpdateServicePickCandidate>[] {
  return candidates.map((candidate) => ({
    key: candidate.repoPath,
    label: candidate.service,
    meta: candidate.repoPath,
    value: candidate,
  }));
}

export function UpdateServicePickDialog({
  state,
  candidates,
}: {
  state: FilterablePickListState;
  candidates: readonly UpdateServicePickCandidate[];
}) {
  return (
    <ModalDialog title={UPDATE_SERVICE_PICK_TITLE} open={true}>
      <FilterablePickList
        label="Filter"
        state={state}
        items={toServicePickItems(candidates)}
        emptyText="No service to select"
        noMatchText="No matching service"
      />
    </ModalDialog>
  );
}
