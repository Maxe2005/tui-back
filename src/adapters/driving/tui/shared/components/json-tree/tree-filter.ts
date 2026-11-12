// tui/shared/components/json-tree/tree-filter: pure reducers over the tree's hide/only/hideNulls
// filter rules (listing, adding, removing, clearing).
import { TreeFilterRules } from './tree-build.js';

export type ActiveRule = { kind: 'hide' | 'only'; key: string };

export function listActiveRules(rules: TreeFilterRules): ActiveRule[] {
  return [
    ...rules.hiddenKeys.map((key): ActiveRule => ({ kind: 'hide', key })),
    ...rules.onlyKeys.map((key): ActiveRule => ({ kind: 'only', key })),
  ];
}

export function countActiveRules(rules: TreeFilterRules): number {
  return rules.hiddenKeys.length + rules.onlyKeys.length + (rules.hideNulls ? 1 : 0);
}

// Every reducer below returns null when the keypress would change nothing, so the zone
// can skip the store update (and the prune-order touch) entirely.
export function addHiddenKey(rules: TreeFilterRules, key: string | null): TreeFilterRules | null {
  if (key === null || key === '' || rules.hiddenKeys.includes(key)) {
    return null;
  }
  return { hiddenKeys: [...rules.hiddenKeys, key], onlyKeys: [...rules.onlyKeys], hideNulls: rules.hideNulls };
}

export function addOnlyKey(rules: TreeFilterRules, key: string | null): TreeFilterRules | null {
  if (key === null || key === '' || rules.onlyKeys.includes(key)) {
    return null;
  }
  return { hiddenKeys: [...rules.hiddenKeys], onlyKeys: [...rules.onlyKeys, key], hideNulls: rules.hideNulls };
}

export function removeActiveRule(rules: TreeFilterRules, index: number): TreeFilterRules | null {
  const active = listActiveRules(rules);
  const target = active[index];
  if (target === undefined) {
    return null;
  }
  return target.kind === 'hide'
    ? { hiddenKeys: rules.hiddenKeys.filter((key) => key !== target.key), onlyKeys: [...rules.onlyKeys], hideNulls: rules.hideNulls }
    : { hiddenKeys: [...rules.hiddenKeys], onlyKeys: rules.onlyKeys.filter((key) => key !== target.key), hideNulls: rules.hideNulls };
}

export function toggleHideNulls(rules: TreeFilterRules): TreeFilterRules {
  return { hiddenKeys: [...rules.hiddenKeys], onlyKeys: [...rules.onlyKeys], hideNulls: !rules.hideNulls };
}

export function clearTreeRules(rules: TreeFilterRules): TreeFilterRules | null {
  if (rules.hiddenKeys.length === 0 && rules.onlyKeys.length === 0 && !rules.hideNulls) {
    return null;
  }
  return { hiddenKeys: [], onlyKeys: [], hideNulls: false };
}
