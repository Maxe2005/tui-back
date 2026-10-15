// tui/zones/routes/saved tab: the Routes right pane's Saved sub-tab listing only the
// pane route's saved requests with a `/` filter. Stateless; the zone owns the pick state,
// the load/delete calls and the route-scoped filtering.
import { Box, Text } from 'ink';
import { DimAnnotation } from '../../shared/components/dim-annotation.js';
import {
  FilterablePickList,
  type FilterablePickItem,
  type FilterablePickListState,
} from '../../shared/components/filterable-pick-list.js';
import { colors } from '../../shared/theme/theme.js';
import type { SavedWithStale } from '../../../../../core/routes/saved-requests.js';
import { ClampedParagraph } from '../../shared/components/truncated-text.js';

export function RoutesSavedTab({
  items,
  pickState,
  error,
  isLoaded,
}: {
  items: readonly FilterablePickItem<SavedWithStale>[];
  pickState: FilterablePickListState;
  error: string | null;
  isLoaded: boolean;
}) {
  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} minHeight={0} overflow="hidden">
      {error !== null ? (
        <ClampedParagraph color={colors.error} maxLines={4}>{`${error}`}</ClampedParagraph>
      ) : null}
      {!isLoaded && error === null ? (
        <DimAnnotation text="Saved requests not loaded." />
      ) : isLoaded ? (
        <FilterablePickList
          label="Filter"
          state={pickState}
          items={items}
          emptyText="No saved requests for this route yet — press s in the Request tab to save one."
          noMatchText="No saved requests match."
        />
      ) : null}
    </Box>
  );
}
