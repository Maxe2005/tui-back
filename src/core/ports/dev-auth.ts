// core/ports/dev-auth: the DevAuthPort a repo's route-explorer module implements (AD-5). Core
// asks it for a session cookie, forcing a refresh when a fired request comes back 401; the
// adapter owns the auth route and the session cache. Error codes: `auth-endpoint-failed`
// (auth route down, non-2xx or no session — cookie never logged), `auth-unauthorized` (still
// 401 after the re-auth budget), `auth-forbidden` (403 on the fired request).
import type { Result } from '../result.js';

export interface DevAuthSession {
  cookie: string;
}

export interface DevAuthOptions {
  forceRefresh?: boolean;
}

export interface DevAuthPort {
  getSession(config: Record<string, unknown>, opts?: DevAuthOptions): Promise<Result<DevAuthSession>>;
}
