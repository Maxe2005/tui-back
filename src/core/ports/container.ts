// core/ports/container: the container port contract. Group update restarts each member
// service's container after its pull/merge; the driven adapter owns how the restart runs.
import type { Result } from '../result.js';

export interface ContainerPort {
  // Restarts the named container. A non-zero runtime exit or an unspawnable runtime both
  // surface as `container-restart-error`, never a throw.
  restart(container: string): Promise<Result<void>>;
}
