// tui/shared/branch-owners-text: the single wording of cross-EDT branch usage in
// every branch chooser: the `⚠`-less annotation text (glyph is added by the renderer) and the
// French inline refusal for applying/renaming a branch another EDT owns.
export type BranchOwners = Readonly<Record<string, readonly string[]>>;

function quoted(topics: readonly string[]): string {
  return topics.map((topic) => `« ${topic} »`).join(', ');
}

// `EDT « topic »` (several owners: `EDT « a », « b »`).
export function ownerAnnotationText(topics: readonly string[]): string {
  return `EDT ${quoted(topics)}`;
}

// Branch -> annotation text, for BranchAutocompleteInput's generic `annotations` prop.
export function ownerAnnotations(owners: BranchOwners | undefined): Record<string, string> {
  // Null prototype: a branch named `constructor`/`__proto__` is plain data, never inherited.
  const annotations = Object.create(null) as Record<string, string>;
  for (const [branch, topics] of Object.entries(owners ?? {})) {
    if (topics.length > 0) {
      annotations[branch] = ownerAnnotationText(topics);
    }
  }
  return annotations;
}

// `utilisée par l'EDT « topic » — la reprendre ou la renommer casserait cet EDT`.
export function ownerRefusalText(topics: readonly string[]): string {
  return `utilisée par l'EDT ${quoted(topics)} — la reprendre ou la renommer casserait cet EDT`;
}

// The picker's own sentence: names the refused branch first.
export function ownerRefusalForBranch(branch: string, topics: readonly string[]): string {
  return `Branche « ${branch} » ${ownerRefusalText(topics)}`;
}
