// core/scripts/group-update/restart: the shared restart step and the interrupted-EDT marker.
import type { ContainerPort } from "../../ports/container.js";
import type { EdtRegistryPort } from "../../ports/edt-registry.js";
import type { RestartPort } from "../../ports/restart.js";
import { err, ok, type Result } from "../../result.js";
import type { OnUpdatePhase } from "./types.js";
import { emitPhase } from "./observers.js";
import { failed } from "./outcome.js";
import { updateWithLoadedManifest } from "./member.js";

// Marks an EDT `interrupted` after an abandoned run (TUI quit-mid-run confirmation) via the
// existing setStatus — the next Update-zone idle render offers a re-run, which is a true
// resume in effect because already-applied merges are no-ops.
export async function markGroupUpdateInterrupted(
  edtRegistry: EdtRegistryPort,
  ulid: string,
): Promise<Result<void>> {
  return edtRegistry.setStatus(ulid, "interrupted");
}

// The shared restart step, called by `updateWithLoadedManifest` and the standalone
// single-service use-case. Recipe (cleanRestart on + non-empty `restartCommands`): each
// command runs in the repo's working directory in declared order via the restart port,
// stopping on the first failure (normalized to a `restart-failed` detail naming the repo, the
// command, and the error output). Otherwise the plain container restart runs — never both
// ports for the same service in the same action.
export interface RestartStepInput {
  container: ContainerPort;
  restart: RestartPort;
  containerName: string | undefined;
  restartCommands: string[] | undefined;
  repoPath: string;
  cleanRestart: boolean;
  // The service label the phase observer reports under, plus the observer itself — emitted
  // once at the restart boundary so the group and standalone paths share the same
  // `restarting` signal (a mid-recipe stop still reports the failure below, never a second
  // phase).
  service: string;
  onPhase?: OnUpdatePhase;
  // Called before each recipe command with its 1-based position, so a caller can show progress.
  onStep?: (step: number, total: number) => void;
}

export async function runRestartStep(
  input: RestartStepInput,
): Promise<Result<void>> {
  const {
    container,
    restart,
    containerName,
    restartCommands,
    repoPath,
    cleanRestart,
    service,
    onPhase,
    onStep,
  } = input;
  emitPhase(onPhase, service, "restarting");
  if (
    cleanRestart &&
    restartCommands !== undefined &&
    restartCommands.length > 0
  ) {
    for (const [index, command] of restartCommands.entries()) {
      onStep?.(index + 1, restartCommands.length);
      const restarted = await restart.run(repoPath, command);
      if (!restarted.ok) {
        return err(
          "restart-failed",
          `Repo ${repoPath} restart "${command}" failed: ${restarted.error.message}`,
        );
      }
    }
    return ok(undefined);
  }
  if (containerName === undefined || containerName.trim() === "") {
    return err(
      "no-container",
      `Repo ${repoPath} declares no container — nothing to restart`,
    );
  }
  const restarted = await container.restart(containerName);
  if (!restarted.ok) {
    // Every row's detail names its repoPath — with duplicate service names in one EDT,
    // the code alone can't tell two rows apart.
    return err(
      restarted.error.code,
      `Repo ${repoPath} container "${containerName}" failed to restart: ${restarted.error.message}`,
    );
  }
  return ok(undefined);
}
