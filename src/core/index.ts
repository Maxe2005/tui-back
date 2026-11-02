// core: domain + application layer — zero import of Ink/React/dockerode/child_process/better-sqlite3/fs (AD-1)
// Relative imports use `.js` specifiers (NodeNext resolution) even though the sources are `.ts`.

export * from './realign/index.js';
