// core/ports/dev-auth: the DevAuthPort a repo's route-explorer module implements
// (story 6.2, AD-5). Core's fire-request use-case acquires the service's session through
// this port without ever importing the driven cookie-session adapter (AD-1); the adapter
// owns where the auth route lives and how the session is cached and refreshed. Session
// cache + refresh stay hidden inside the module — core only asks for a cookie, forcing a
// refresh whenever a fired request comes back 401.
//
// Error codes owned by this capability: `auth-endpoint-failed` (the service's auth route
// is down, non-2xx, or yielded no session — never a throw, cookie never logged),
// `auth-unauthorized` (still 401 after the re-auth budget), `auth-forbidden` (403 on the
// fired request — a permission mismatch, distinct from a generic failure). All kebab-case
// per AD-3.
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
