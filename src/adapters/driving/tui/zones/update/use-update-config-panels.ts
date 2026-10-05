// tui/zones/update: React glue of the two-panel update configuration. Holds the zone-local view
// state (focus, cursors, the EDT field, the service box), loads what the fields suggest (EDT
// topics once on open, a repo's branches once per box session) and turns each key step from
// the pure reducers into draft/store changes. The zone's `useInput` only forwards keys here.
import { useEffect, useRef, useState } from 'react';
import type { Result } from '../../../../../core/result.js';
import { createSuggestFieldState, type SuggestFieldState } from '../../shared/components/suggest-field.logic.js';
import { applyMergeStrategy, type UpdateConfigDraft } from './update-config-dialog.logic.js';
import {
  checkEdtChoice,
  clampPanelCursor,
  clampTableCursor,
  computeConfigBudget,
  globalLines,
  resetRowToGlobal,
  resolvePanelsKey,
  toggleGlobalLine,
  toggleMergeSource,
  toggleRowSelection,
  type ConfigBudget,
  type PanelsKey,
  type PanelsViewState,
} from './update-config-panels.logic.js';
import {
  applyServiceBox,
  openServiceBox,
  reduceServiceBoxKey,
  type ServiceBoxContext,
  type ServiceBoxState,
} from './update-service-box.logic.js';

export interface UseUpdateConfigPanelsInput {
  draft: UpdateConfigDraft | null;
  windowRows: number;
  dropdownMax: number;
  setUpdateConfig: (draft: UpdateConfigDraft) => void;
  closeUpdateConfig: () => void;
  confirmUpdateConfig: () => Promise<void>;
  listMergeSourceEdts: () => Promise<{ ulid: string; topic: string }[]>;
  chooseMergeSourceEdt: (ulid: string) => Promise<void>;
  listBranches: (repoPath: string) => Promise<Result<string[]>>;
}

export interface UpdateConfigPanelsController {
  view: PanelsViewState;
  box: ServiceBoxState | null;
  boxContext: ServiceBoxContext | null;
  edtField: SuggestFieldState;
  edtTopics: string[];
  edtStatus: 'loading' | 'ready' | 'error';
  budget: ConfigBudget;
  handleKey: (input: string, key: PanelsKey & { escape?: boolean }) => void;
}

const INITIAL_VIEW: PanelsViewState = { focus: 'panel', panelCursor: 0, tableCursor: 0, edtField: null };

export function useUpdateConfigPanels(input: UseUpdateConfigPanelsInput): UpdateConfigPanelsController {
  const { draft } = input;
  const panelsOpen = draft !== null && draft.layout !== 'simple';
  const [view, setViewState] = useState<PanelsViewState>(INITIAL_VIEW);
  const [box, setBoxState] = useState<ServiceBoxState | null>(null);
  // Keys can arrive faster than React re-renders (key repeat, paste): the handler reads the
  // latest view and box from refs updated synchronously, so each key builds on the previous.
  const viewRef = useRef(view);
  const boxRef = useRef(box);
  const setView = (next: PanelsViewState) => {
    viewRef.current = next;
    setViewState(next);
  };
  const setBox = (next: ServiceBoxState | null) => {
    boxRef.current = next;
    setBoxState(next);
  };
  const [edts, setEdts] = useState<{ ulid: string; topic: string }[]>([]);
  const [edtStatus, setEdtStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [branches, setBranches] = useState<string[]>([]);
  const [branchesStatus, setBranchesStatus] = useState<'loading' | 'ready' | 'error'>('loading');

  // Fresh view every time a panels screen opens.
  useEffect(() => {
    if (panelsOpen) {
      setView(INITIAL_VIEW);
      setBox(null);
      setEdtStatus('loading');
    }
  }, [panelsOpen]);

  const wantsEdts = panelsOpen && draft.layout === 'edt-panels';
  useEffect(() => {
    if (!wantsEdts) {
      return;
    }
    let cancelled = false;
    input
      .listMergeSourceEdts()
      .then((listed) => {
        if (!cancelled) {
          setEdts(listed);
          setEdtStatus('ready');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setEdtStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsEdts]);

  const boxRepoPath = box !== null && draft !== null ? (draft.rows[box.index]?.repoPath ?? null) : null;
  useEffect(() => {
    if (boxRepoPath === null) {
      return;
    }
    let cancelled = false;
    // Another service's list must never be offered (or validated against) while this one loads.
    setBranches([]);
    setBranchesStatus('loading');
    input
      .listBranches(boxRepoPath)
      .then((result) => {
        if (!cancelled) {
          setBranches(result.ok ? result.data : []);
          setBranchesStatus(result.ok ? 'ready' : 'error');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBranchesStatus('error');
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxRepoPath]);

  const edtTopics = edts.map((edt) => edt.topic);
  const boxRow = box !== null && draft !== null ? draft.rows[box.index] : undefined;
  const boxContext: ServiceBoxContext | null =
    boxRow !== undefined
      ? {
          service: boxRow.service,
          branches,
          branchesStatus,
          migrationDeclared: boxRow.migrationDeclared,
          recipeDeclared: boxRow.recipeDeclared,
        }
      : null;
  const budget: ConfigBudget =
    draft !== null
      ? computeConfigBudget(input.windowRows, draft, view.edtField !== null, input.dropdownMax, box !== null)
      : { tooSmall: false, tableRows: 0, dropdownLines: 0, boxDropdownLines: 0 };

  const handleKey = (key_input: string, key: PanelsKey & { escape?: boolean }) => {
    if (draft === null) {
      return;
    }
    // While only the "terminal too small" message is visible, nothing but closing is allowed:
    // no key may act on a configuration the developer cannot see.
    if (budget.tooSmall) {
      if (key.escape === true) {
        input.closeUpdateConfig();
      }
      return;
    }
    const view = viewRef.current;
    const box = boxRef.current;
    if (box !== null && boxContext !== null) {
      const step = reduceServiceBoxKey(box, boxContext, key_input, key);
      if (step.type === 'update') {
        setBox(step.box);
      } else if (step.type === 'close') {
        setBox(null);
      } else if (step.type === 'revert') {
        input.setUpdateConfig(resetRowToGlobal(draft, box.index));
        setBox(null);
      } else {
        const applied = applyServiceBox(draft, box, boxContext);
        if (applied.ok) {
          input.setUpdateConfig(applied.draft);
          setBox(null);
        } else {
          setBox({ ...box, error: applied.error });
        }
      }
      return;
    }
    const cursorView: PanelsViewState = {
      ...view,
      panelCursor: clampPanelCursor(draft, view.panelCursor),
      tableCursor: clampTableCursor(draft, view.tableCursor),
    };
    const step = resolvePanelsKey(key_input, key, cursorView, draft, edtTopics);
    switch (step.type) {
      case 'move-panel':
        setView({ ...cursorView, panelCursor: step.cursor });
        break;
      case 'move-table':
        setView({ ...cursorView, tableCursor: step.cursor });
        break;
      case 'switch-focus':
        setView({ ...cursorView, focus: cursorView.focus === 'panel' ? 'table' : 'panel' });
        break;
      case 'toggle-global':
        input.setUpdateConfig(toggleGlobalLine(draft, step.line));
        break;
      case 'toggle-source': {
        const next = toggleMergeSource(draft);
        input.setUpdateConfig(next);
        if (next.strategy.kind === 'shared') {
          setView({ ...cursorView, panelCursor: clampPanelCursor(next, cursorView.panelCursor) });
        } else {
          setView({ ...cursorView, panelCursor: globalLines(next).indexOf('edt'), edtField: createSuggestFieldState('') });
        }
        break;
      }
      case 'edit-edt': {
        const current = draft.strategy.kind === 'edt' ? draft.strategy.topic : '';
        setView({ ...cursorView, edtField: createSuggestFieldState(step.initial !== '' ? step.initial : current) });
        break;
      }
      case 'edt-edit':
        setView({ ...cursorView, edtField: step.field });
        break;
      case 'edt-cancel':
        setView({ ...cursorView, edtField: null });
        break;
      case 'edt-commit': {
        // The topics are not known yet: a valid topic would be refused as unknown.
        if (edtStatus === 'loading') {
          break;
        }
        const choice = checkEdtChoice(step.value, edts);
        if (choice.type === 'invalid') {
          input.setUpdateConfig({ ...draft, error: choice.message });
          break;
        }
        setView({ ...cursorView, edtField: null });
        if (choice.type === 'none') {
          input.setUpdateConfig(applyMergeStrategy(draft, { kind: 'edt-pending' }));
        } else {
          void input.chooseMergeSourceEdt(choice.ulid);
        }
        break;
      }
      case 'toggle-row':
        input.setUpdateConfig(toggleRowSelection(draft, cursorView.tableCursor));
        break;
      case 'open-box':
        setBox(openServiceBox(draft, cursorView.tableCursor));
        break;
      case 'reset-row':
        input.setUpdateConfig(resetRowToGlobal(draft, cursorView.tableCursor));
        break;
      case 'confirm':
        void input.confirmUpdateConfig();
        break;
      case 'cancel':
        input.closeUpdateConfig();
        break;
      default:
        break;
    }
  };

  return {
    view,
    box,
    boxContext,
    edtField: view.edtField ?? createSuggestFieldState(''),
    edtTopics,
    edtStatus,
    budget,
    handleKey,
  };
}
