import { err, ok, type Result } from '../../../core/result.js';
import { generateBashCompletion, type CompletionCommand } from './completion-spec.js';
import type { Subcommand } from './dispatch.js';

// adapters/driving/cli/install: the `install` subcommand and its pure helpers (Node check, git
// spec derivation, marked ~/.bashrc block). All process spawning and file I/O sits behind
// InstallerPort, implemented by adapters/driven/installer.

export const INSTALL_USAGE = 'tui-back install [--uninstall]';
export const PACKAGE_NAME = 'tui-back';
export const MIN_NODE_MAJOR = 24;
export const RC_START_MARKER = '# >>> tui-back >>>';
export const RC_END_MARKER = '# <<< tui-back <<<';

export type NpmOutcome =
  | { ok: true }
  | { ok: false; kind: 'permission-denied' | 'npm-not-found' | 'failed'; message: string };

export interface InstallerPort {
  /** Repository URL declared in the package's own package.json, or null when absent. */
  repositoryUrl(): Promise<string | null>;
  npmGlobal(action: 'install' | 'uninstall', target: string): Promise<NpmOutcome>;
  /** File content, or null when the file does not exist. */
  readFile(path: string): Promise<string | null>;
  writeFile(path: string, content: string): Promise<void>;
  /** Returns whether a file was actually removed. */
  removeFile(path: string): Promise<boolean>;
}

export interface InstallDeps {
  installer: InstallerPort;
  nodeVersion: string;
  env: NodeJS.ProcessEnv;
  homedir: string;
  dataDir: string;
  /** Read lazily so the generated completion includes `install` itself. */
  commands: () => CompletionCommand[];
}

export function parseNodeMajor(version: string): number | null {
  const match = /^v?(\d+)\./.exec(version);
  return match === null ? null : Number(match[1]);
}

export function isSupportedNode(version: string): boolean {
  const major = parseNodeMajor(version);
  return major !== null && major >= MIN_NODE_MAJOR;
}

export function nodeUpgradeInstructions(version: string): string {
  return [
    `tui-back needs Node >= ${String(MIN_NODE_MAJOR)} (found ${version}). Nothing was changed.`,
    `  nvm:   nvm install ${String(MIN_NODE_MAJOR)} && nvm use ${String(MIN_NODE_MAJOR)}`,
    `  apt:   follow https://github.com/nodesource/distributions to install Node ${String(MIN_NODE_MAJOR)}, then sudo apt-get install -y nodejs`,
    `  brew:  brew install node@${String(MIN_NODE_MAJOR)}`,
  ].join('\n');
}

/** `github:<owner>/<repo>` from a package.json `repository` URL, or null if it is not a GitHub URL. */
export function githubSpecFromRepository(url: string): string | null {
  const match = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim());
  if (match !== null) {
    return `github:${match[1]}/${match[2]}`;
  }
  const shorthand = /^github:([^/\s]+\/[^/\s]+)$/.exec(url.trim());
  return shorthand === null ? null : `github:${shorthand[1]}`;
}

export function renderRcBlock(completionFile: string): string {
  return [
    RC_START_MARKER,
    "alias tb='tui-back'",
    "alias tbt='tui-back tui'",
    `[ -f "${completionFile}" ] && source "${completionFile}"`,
    RC_END_MARKER,
  ].join('\n');
}

interface BlockSpan {
  start: number;
  end: number;
}

function findBlocks(content: string): BlockSpan[] {
  const spans: BlockSpan[] = [];
  let from = 0;
  for (;;) {
    const start = content.indexOf(RC_START_MARKER, from);
    if (start === -1) {
      return spans;
    }
    const endMarker = content.indexOf(RC_END_MARKER, start + RC_START_MARKER.length);
    if (endMarker === -1) {
      return spans;
    }
    let end = endMarker + RC_END_MARKER.length;
    if (content[end] === '\n') {
      end += 1;
    }
    spans.push({ start, end });
    from = end;
  }
}

/** Replaces the marked block in place (collapsing duplicates), or appends it; the rest is untouched. */
export function upsertRcBlock(content: string, block: string): string {
  const spans = findBlocks(content);
  if (spans.length === 0) {
    const separator = content === '' || content.endsWith('\n') ? '' : '\n';
    return `${content}${separator}${block}\n`;
  }
  let result = '';
  let cursor = 0;
  spans.forEach((span, index) => {
    result += content.slice(cursor, span.start);
    if (index === 0) {
      result += `${block}\n`;
    }
    cursor = span.end;
  });
  return result + content.slice(cursor);
}

/** Removes every marked block; returns null when there was none (nothing to write). */
export function removeRcBlock(content: string): string | null {
  const spans = findBlocks(content);
  if (spans.length === 0) {
    return null;
  }
  let result = '';
  let cursor = 0;
  for (const span of spans) {
    result += content.slice(cursor, span.start);
    cursor = span.end;
  }
  return result + content.slice(cursor);
}

const EACCES_REMEDY = [
  'npm cannot write to its global prefix (EACCES). Use a user-owned prefix, then re-run:',
  '  npm config set prefix ~/.local',
  '  export PATH="$HOME/.local/bin:$PATH"   # also add this line to ~/.bashrc',
].join('\n');

function npmFailure(outcome: Extract<NpmOutcome, { ok: false }>): Result<never> {
  if (outcome.kind === 'permission-denied') {
    return err('permission-denied', EACCES_REMEDY, { remedy: ['npm config set prefix ~/.local', 'export PATH="$HOME/.local/bin:$PATH"'] });
  }
  if (outcome.kind === 'npm-not-found') {
    return err('npm-not-found', 'npm was not found on PATH. Install Node.js with npm, then re-run.');
  }
  return err('npm-failed', `npm failed: ${outcome.message}`);
}

export interface InstallData {
  npmInstalled: boolean;
  completionFile: string;
  rcFile: string;
  shellWarning: string | null;
  nextStep: string;
}

export interface UninstallData {
  npmRemoved: boolean;
  completionRemoved: boolean;
  rcBlockRemoved: boolean;
  completionFile: string;
  rcFile: string;
  nextStep: string;
}

const RELOAD_HINT = 'Run `source ~/.bashrc` (or open a new shell) to apply the change.';

export function createInstallSubcommand(deps: InstallDeps): Subcommand {
  const completionFile = `${deps.dataDir}/completion.bash`;
  const rcFile = `${deps.homedir}/.bashrc`;

  async function install(): Promise<Result<InstallData>> {
    if (!isSupportedNode(deps.nodeVersion)) {
      return err('unsupported-node', nodeUpgradeInstructions(deps.nodeVersion), { nodeVersion: deps.nodeVersion });
    }
    const repository = await deps.installer.repositoryUrl();
    const spec = repository === null ? null : githubSpecFromRepository(repository);
    if (spec === null) {
      return err('repository-unresolved', 'package.json has no GitHub "repository" URL to install from.');
    }
    const npm = await deps.installer.npmGlobal('install', spec);
    if (!npm.ok) {
      return npmFailure(npm);
    }
    await deps.installer.writeFile(completionFile, generateBashCompletion({ commands: deps.commands() }));
    const existing = (await deps.installer.readFile(rcFile)) ?? '';
    await deps.installer.writeFile(rcFile, upsertRcBlock(existing, renderRcBlock(completionFile)));
    const shell = deps.env.SHELL ?? '';
    const shellWarning = /(^|\/)bash$/.test(shell)
      ? null
      : `Your shell (${shell === '' ? 'unknown' : shell}) is not bash: only ~/.bashrc was configured, aliases and completion will not load elsewhere.`;
    return ok({ npmInstalled: true, completionFile, rcFile, shellWarning, nextStep: RELOAD_HINT });
  }

  async function uninstall(): Promise<Result<UninstallData>> {
    const rc = await deps.installer.readFile(rcFile);
    const stripped = rc === null ? null : removeRcBlock(rc);
    if (stripped !== null) {
      await deps.installer.writeFile(rcFile, stripped);
    }
    const completionRemoved = await deps.installer.removeFile(completionFile);
    const npm = await deps.installer.npmGlobal('uninstall', PACKAGE_NAME);
    if (!npm.ok) {
      return npmFailure(npm);
    }
    return ok({
      npmRemoved: true,
      completionRemoved,
      rcBlockRemoved: stripped !== null,
      completionFile,
      rcFile,
      nextStep: RELOAD_HINT,
    });
  }

  return {
    name: 'install',
    usage: INSTALL_USAGE,
    run: async (args) => {
      if (args.length > 1 || (args.length === 1 && args[0] !== '--uninstall')) {
        return err('invalid-argument', `Usage: ${INSTALL_USAGE}`);
      }
      return args.length === 1 ? uninstall() : install();
    },
    humanText: (data) => {
      const d = data as Partial<InstallData & UninstallData>;
      const lines =
        d.npmInstalled === true
          ? [
              `Installed ${PACKAGE_NAME} globally via npm.`,
              `Completion: ${d.completionFile ?? ''}`,
              `Aliases and completion block: ${d.rcFile ?? ''}`,
              ...(d.shellWarning ? [`Warning: ${d.shellWarning}`] : []),
            ]
          : [
              `Removed ${PACKAGE_NAME} (global package, completion file ${d.completionRemoved === true ? 'removed' : 'absent'}, rc block ${d.rcBlockRemoved === true ? 'removed' : 'absent'}).`,
            ];
      return [...lines, d.nextStep ?? RELOAD_HINT].join('\n');
    },
  };
}
