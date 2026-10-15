// tui/shared/keys: the subset of Ink's `Key` type every list-navigation pure function reads,
// shared so the shape can't drift across call sites. Arrow/Home/End/Tab keys produce an empty
// `input` string in Ink — only these flags are set.
export type NavigationKey = {
  upArrow: boolean;
  downArrow: boolean;
  home: boolean;
  end: boolean;
  tab: boolean;
};
