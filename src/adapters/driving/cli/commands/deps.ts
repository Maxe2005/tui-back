// cli/commands/deps: the dependency bag `buildSubcommands` receives, shared by every command-family module.
import { ContainerPort } from '../../../../core/ports/runtime/container.js';
import { DevAuthPort } from '../../../../core/ports/runtime/dev-auth.js';
import { DockerPort } from '../../../../core/ports/runtime/docker.js';
import { EditorPort } from '../../../../core/ports/runtime/editor.js';
import { HealthProbePort } from '../../../../core/ports/runtime/health-probe.js';
import { GitPort } from '../../../../core/ports/vcs/git.js';
import { ManifestPort } from '../../../../core/ports/vcs/manifest.js';
import { ManifestCarryPort } from '../../../../core/ports/vcs/manifest-carry.js';
import { MigrationPort } from '../../../../core/ports/vcs/migration.js';
import { RestartPort } from '../../../../core/ports/runtime/restart.js';
import { RegistryPort } from '../../../../core/ports/storage/registry.js';
import { EdtRegistryPort } from '../../../../core/ports/storage/edt-registry.js';
import { LockPort } from '../../../../core/ports/runtime/lock.js';
import { RouteScannerPort } from '../../../../core/ports/modules/route-scanner.js';
import { SavedRequestPort } from '../../../../core/ports/storage/saved-request.js';
import { type SettingsPort } from '../../../../core/ports/storage/settings.js';
import { StatePort } from '../../../../core/ports/storage/state.js';
import { type InstallerPort } from '../install.js';

export type SubcommandDeps = {
  registry: RegistryPort;
  manifest: ManifestPort;
  manifestCarry: ManifestCarryPort;
  lock: LockPort;
  registryResourceKey: string;
  edtsBaseDir: string;
  edtRegistry: EdtRegistryPort;
  edtRegistryResourceKey: string;
  git: GitPort;
  container: ContainerPort;
  docker: DockerPort;
  migration: MigrationPort;
  restart: RestartPort;
  state: StatePort;
  // Source of the `update` defaults (runMigrations / cleanRestart); a load failure or warning is reported on stderr and the built-in defaults apply.
  settings: SettingsPort;
  // The post-switch restart's verification ports (`edt switch --restart`, with `docker` above).
  // Optional: without them a restart request is rejected up front, before anything is touched.
  editor?: EditorPort;
  healthProbe?: HealthProbePort;
  // Gates `registry clean`'s bare-invocation interactive list-then-confirm prompt. Defaults to
  // false (never prompts); only bin/main.ts wires it, and only when BOTH stdout and stdin are
  // real TTYs — a piped stdin must never let `rl.question()` block on or misread a
  // nonexistent answer.
  isTTY?: boolean;
  scanner: RouteScannerPort;
  auth: DevAuthPort;
  savedRequests: SavedRequestPort;
  // `install` wiring: the real installer plus the runtime facts it checks (Node version, SHELL, home, XDG data dir).
  install: { installer: InstallerPort; nodeVersion: string; env: NodeJS.ProcessEnv; homedir: string; dataDir: string };
};
