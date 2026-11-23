// tui/zones/routes: use-routes-input — registers the zone's single `useInput` and dispatches to the per-mode key handlers in the original priority order.
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import {
  handleOverwriteConfirmKey,
  handlePickerDeleteConfirmKey,
  handlePickerKey,
  handleSavedTabDeleteConfirmKey,
  handleSavePromptKey,
} from '../routes-zone.overlay-keys.js';
import { handleFilterEditingKey, handleListKey } from '../routes-zone.list-keys.js';
import { handlePaneKey } from '../routes-zone.pane-keys.js';
import { useInput } from '../../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../../shared/hooks/use-zone-input-active.js';

export function useRoutesInput(c: RoutesZoneCtx): void {
  const { useStore, overwriteConfirm, pickerDeleteConfirm, savedTabDeleteConfirm, savePrompt, pickerOpen, filterEditing, paneFocused } = c;
  const zoneInputActive = useZoneInputActive(useStore);
  useInput(
    (input, key) => {
      // Priority order (Ink input): overlays first, then the filter input, then the focused pane, then the list.
      if (overwriteConfirm !== null) {
        handleOverwriteConfirmKey(c, input, key);
        return;
      }
      if (pickerDeleteConfirm !== null) {
        handlePickerDeleteConfirmKey(c, pickerDeleteConfirm, input, key);
        return;
      }
      if (savedTabDeleteConfirm !== null) {
        handleSavedTabDeleteConfirmKey(c, savedTabDeleteConfirm, input, key);
        return;
      }
      if (savePrompt !== null) {
        handleSavePromptKey(c, savePrompt, input, key);
        return;
      }
      if (pickerOpen) {
        handlePickerKey(c, input, key);
        return;
      }
      if (filterEditing) {
        handleFilterEditingKey(c, input, key);
        return;
      }
      if (paneFocused) {
        handlePaneKey(c, input, key);
        return;
      }
      handleListKey(c, input, key);
    },
    { isActive: zoneInputActive },
  );
}
