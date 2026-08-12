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
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
  },
}
