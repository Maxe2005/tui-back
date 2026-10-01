// tui/zones/update: the EDT quick-pick opened from the merge-source panel. Interaction is the
// shared filterable list; this file only maps EDT candidates to pick items and titles it.
import {
  FilterablePickList,
  type FilterablePickItem,
  type FilterablePickListState,
} from '../../shared/components/filterable-pick-list.js';
import { ModalDialog } from '../../shared/components/modal-dialog.js';

export const MERGE_EDT_PICK_TITLE = 'MERGE FROM EDT';

export type MergeEdtCandidate = { ulid: string; topic: string };

export function toMergeEdtPickItems(candidates: readonly MergeEdtCandidate[]): FilterablePickItem<MergeEdtCandidate>[] {
  return candidates.map((candidate) => ({ key: candidate.ulid, label: candidate.topic, value: candidate }));
}

export function MergeEdtPickDialog({
  state,
  candidates,
}: {
  state: FilterablePickListState;
  candidates: readonly MergeEdtCandidate[];
}) {
  return (
    <ModalDialog title={MERGE_EDT_PICK_TITLE} onConfirm={() => {}} onCancel={() => {}} open>
      <FilterablePickList
        label="Filter"
        state={state}
        items={toMergeEdtPickItems(candidates)}
        emptyText="No other EDT to merge from"
        noMatchText="No matching EDT"
      />
    </ModalDialog>
  );
}
