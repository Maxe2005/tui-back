// core/ports/settings: the pure helpers the settings model ships with.
import { describe, expect, it } from 'vitest';
import type { Manifest } from './manifest.js';
import { DEFAULT_SETTINGS, healthCheckEnabledFrom, type Settings } from './settings.js';

const manifest = (service: string): Manifest => ({ service, sharedBranch: 'development', modules: {} });

describe('healthCheckEnabledFrom', () => {
  it('is enabled unless the service is listed, and reads the getter on every call', () => {
    let settings: Settings = DEFAULT_SETTINGS;
    const enabled = healthCheckEnabledFrom(() => settings);
    expect(enabled(manifest('api'))).toBe(true);
    settings = { ...DEFAULT_SETTINGS, services: { healthCheckDisabled: ['api'] } };
    expect(enabled(manifest('api'))).toBe(false);
    expect(enabled(manifest('auth'))).toBe(true);
  });

  it('treats a getter with no settings yet as every check enabled', () => {
    expect(healthCheckEnabledFrom(() => null)(manifest('api'))).toBe(true);
  });
});
