module.exports = {
  forbidden: [
    {
      name: 'no-core-to-adapters',
      comment: 'core is the domain/application layer; it must never import from adapters (AD-1)',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/adapters' },
    },
  ],
}
