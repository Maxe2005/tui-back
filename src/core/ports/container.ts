// core/ports/container: the container port contract (story 3.1). Group update restarts
// each member service's container after its pull/merge; the driven adapter owns how that
// restart is executed (child_process against the container runtime). Core consumes the
// contract without ever importing the adapter (AD-1).
import type { Result } from '../result.js';

export interface ContainerPort {
  // Restarts the named container. A non-zero runtime exit or an unspawnable runtime both
  // surface as `container-restart-error`, never a throw.
  restart(container: string): Promise<Result<void>>;
}
