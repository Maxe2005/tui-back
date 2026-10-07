import { describe, expect, it } from 'vitest';
import { updateFooterContext, type UpdateFooterInput } from './update-zone.logic.js';

const IDLE: UpdateFooterInput = { blocker: false, config: null, servicePick: false, quitConfirm: false, serviceMenu: false, selectRequest: false };

describe('updateFooterContext', () => {
  const cases: Array<[string, Partial<UpdateFooterInput>, string | null]> = [
    ['nothing open', {}, null],
    ['blocker menu', { blocker: true }, 'menu'],
    ['quit confirmation', { quitConfirm: true }, 'confirm'],
    ['service actions menu', { serviceMenu: true }, 'menu'],
    ['service quick-pick', { servicePick: true }, 'menu'],
    ['config screen, global panel', { config: 'update-config-global' }, 'update-config-global'],
    ['config screen outranks the quick-pick', { config: 'update-box', servicePick: true }, 'update-box'],
    ['blocker outranks the config screen', { blocker: true, config: 'update-config-table' }, 'menu'],
    ['quit confirmation outranks the service menu', { quitConfirm: true, serviceMenu: true }, 'confirm'],
    ['pending :update-service request', { selectRequest: true }, 'busy'],
    ['an open dialog outranks a pending request', { serviceMenu: true, selectRequest: true }, 'menu'],
  ];

  it.each(cases)('%s', (_name, overrides, expected) => {
    expect(updateFooterContext({ ...IDLE, ...overrides })).toBe(expected);
  });
});
