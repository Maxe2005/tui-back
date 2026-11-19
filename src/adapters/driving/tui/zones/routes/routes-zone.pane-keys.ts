// tui/zones/routes: routes-zone.pane-keys — key dispatcher while the right pane holds focus. Open sub-editors own every key first; then Ctrl+R fires,
// Ctrl+→/N and Ctrl+←/P switch sub-tabs (no wrap), `s` saves, and each tab handles the rest.
import type { Key } from 'ink';
import type { RoutesZoneCtx } from './routes-zone.ctx.js';
import { ROUTES_PANE_TABS } from '../../store/slices/routes-slice.js';
import { handleRequestTabKey } from './routes-zone.request-keys.js';
import { handleResponseTabKey } from './routes-zone.response-keys.js';
import { handleSavedTabKey } from './routes-zone.saved-tab-keys.js';
import { nextTextInputValue } from '../../shared/components/text-edit.js';
import { resolveTabNavKey, stepTab } from '../../shared/keys/tab-navigation.js';

export function handlePaneKey(c: RoutesZoneCtx, input: string, key: Key): void {
  const {
    paneTab, setPaneTab, setFilterPanelOpen, setPanelCursor, rowEdit, setRowEdit, rowAddPrompt,
    setRowAddPrompt, scalarEdit, setScalarEdit, addPrompt, setAddPrompt, rawEditor, setRawEditor, editorOpen,
    confirmScalarEdit, confirmAddPrompt, leaveRawEditor, openSavePrompt, firePaneRoute, confirmRowEdit,
    confirmRowAdd,
  } = c;
  if (editorOpen) {
    if (rawEditor !== null) {
      if (key.escape === true) {
        leaveRawEditor();
        return;
      }
      if (key.return === true) {
        const cursor = Math.min(Math.max(rawEditor.input.cursor, 0), rawEditor.input.value.length);
        const value = `${rawEditor.input.value.slice(0, cursor)}\n${rawEditor.input.value.slice(cursor)}`;
        setRawEditor({ input: { value, cursor: cursor + 1 }, error: rawEditor.error });
        return;
      }
      if (key.upArrow === true || key.downArrow === true) {
        return;
      }
      setRawEditor((previous) =>
        previous === null ? previous : { input: nextTextInputValue(previous.input, input, key), error: previous.error },
      );
      return;
    }
    if (scalarEdit !== null) {
      if (key.escape === true) {
        setScalarEdit(null);
        return;
      }
      if (key.return === true) {
        confirmScalarEdit();
        return;
      }
      if (key.upArrow === true || key.downArrow === true) {
        return;
      }
      setScalarEdit((previous) =>
        previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) },
      );
      return;
    }
    if (addPrompt !== null) {
      if (key.escape === true) {
        setAddPrompt(null);
        return;
      }
      if (key.return === true) {
        confirmAddPrompt();
        return;
      }
      if (key.upArrow === true || key.downArrow === true) {
        return;
      }
      setAddPrompt((previous) =>
        previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) },
      );
      return;
    }
  }
  if (rowEdit !== null) {
    if (key.escape === true) {
      setRowEdit(null);
      return;
    }
    if (key.return === true) {
      confirmRowEdit();
      return;
    }
    if (key.upArrow === true || key.downArrow === true || key.tab === true) {
      return;
    }
    setRowEdit((previous) => (previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) }));
    return;
  }
  if (rowAddPrompt !== null) {
    if (key.escape === true) {
      setRowAddPrompt(null);
      return;
    }
    if (key.return === true) {
      confirmRowAdd();
      return;
    }
    if (key.upArrow === true || key.downArrow === true || key.tab === true) {
      return;
    }
    setRowAddPrompt((previous) =>
      previous === null ? previous : { ...previous, input: nextTextInputValue(previous.input, input, key) },
    );
    return;
  }
  if (key.ctrl === true && (input === 'r' || input === 'R')) {
    firePaneRoute();
    return;
  }
  const tabNav = resolveTabNavKey(input, key);
  if (tabNav !== null) {
    const nextTab = stepTab(ROUTES_PANE_TABS, paneTab, tabNav);
    if (nextTab !== paneTab) {
      setPaneTab(nextTab);
      setFilterPanelOpen(false);
      setPanelCursor(0);
    }
    return;
  }
  if (key.ctrl === true || key.meta === true) {
    return;
  }
  // `w` saves the draft under a name (prefilled with the origin name when the draft
  // came from a saved request); every inline sub-editor above already owns its keys.
  // Not `s`: that is the shared-types zone mnemonic.
  if ((input === 'w' || input === 'W') && paneTab === 'request') {
    openSavePrompt();
    return;
  }
  if (paneTab === 'saved') {
    handleSavedTabKey(c, input, key);
    return;
  }
  if (paneTab === 'request') {
    handleRequestTabKey(c, input, key);
    return;
  }
  handleResponseTabKey(c, input, key);
}
