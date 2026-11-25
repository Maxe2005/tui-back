// tui/zones/routes: use-routes-input — registers the zone's single `useInput` and dispatches to the per-mode key handlers in the original priority order.
import type { RoutesZoneCtx } from '../routes-zone.ctx.js';
import {
  handleOverwriteConfirmKey,
  handlePickerDeleteConfirmKey,
  handlePickerKey,
  handleSavedTabDeleteConfirmKey,
  handleSavePromptKey,
} from '../keys/routes-zone.overlay-keys.js';
import { handleFilterEditingKey, handleListKey } from '../keys/routes-zone.list-keys.js';
import { handleFavoritesKey } from '../keys/routes-zone.favorites-keys.js';
import { handleSmokeConfirmKey, handleSmokeKey } from '../keys/routes-zone.smoke-keys.js';
import { handleRecentKey } from '../keys/routes-zone.recent-keys.js';
import { handlePaneKey } from '../keys/routes-zone.pane-keys.js';
import { handleRawPaste } from '../keys/routes-zone.raw-keys.js';
import { usePaste } from 'ink';
import { useInput } from '../../../shared/hooks/use-input.js';
import { useZoneInputActive } from '../../../shared/hooks/use-zone-input-active.js';

export function useRoutesInput(c: RoutesZoneCtx): void {
  const { useStore, overwriteConfirm, pickerDeleteConfirm, savedTabDeleteConfirm, savePrompt, pickerOpen, filterEditing, paneFocused, favoritesFocused, recentFocused, smokeConfirm, smokeVisible } = c;
  const zoneInputActive = useZoneInputActive(useStore);
  // Bracketed paste (Ink 7): a pasted payload arrives as ONE string, never as key presses, and is one undo step.
  usePaste((text) => handleRawPaste(c, text), { isActive: zoneInputActive && c.editorOpen && c.rawEditor !== null && paneFocused });
  useInput(
    (input, key) => {
      // Priority order (Ink input): overlays first, then the filter input, then the focused pane, then the list.
      if (smokeConfirm !== null) {
        handleSmokeConfirmKey(c, input, key);
        return;
      }
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
      if (favoritesFocused) {
        if (smokeVisible) {
          handleSmokeKey(c, input, key);
          return;
        }
        handleFavoritesKey(c, input, key);
        return;
      }
      if (recentFocused) {
        handleRecentKey(c, input, key);
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
