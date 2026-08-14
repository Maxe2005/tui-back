module.exports = {
  forbidden: [
    {
      name: 'no-core-to-adapters',
      comment:
        'core is the domain/application layer; it must never import from adapters (AD-1). ' +
        'to.path deliberately has no "^src/" anchor: this project\'s tsconfig.json mandates ' +
        'NodeNext-style relative imports ("./foo.js" resolving to "./foo.ts"), which ' +
        'dependency-cruiser@18.2.0 cannot resolve (couldNotResolve: true) and therefore ' +
        'records only as the raw unresolved specifier (e.g. "../adapters/driven/xdg/index.js") ' +
        'in `resolved` — an anchored "^src/adapters(/|$)" pattern silently never matches that ' +
        'shape. See deferred-work.md, "Deferred from: dev of story-1-2..." for the investigation.',
      severity: 'error',
      from: { path: '^src/core(/|$)' },
      to: { path: 'adapters(/|$)' },
    },
    {
      name: 'no-tui-leak-outside-driving-tui',
      comment:
        'The Atelier theme and every future TUI/shared component are TUI-only (AD-3): ' +
        'nothing outside the TUI driving adapter may import them. CLI text output ' +
        '(dispatch.ts/envelope.ts) keeps its own rendering; the same NodeNext raw-specifier ' +
        'caveat as no-core-to-adapters applies, so to.path is unanchored.',
      severity: 'error',
      from: { pathNot: '^src/adapters/driving/tui(/|$)' },
      to: { path: 'tui(/|$)' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
  },
}
