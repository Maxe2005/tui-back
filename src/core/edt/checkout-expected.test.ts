// core/edt/checkout-expected: unit tests for the shared resolve → prepare → checkout step.
import { describe, expect, it, vi } from 'vitest';
import { err, ok, type ResultError } from '../result.js';
import type { GitPort } from '../ports/git.js';
import { checkoutExpectedBranch, memberTargetSpec, type CheckoutStep } from './checkout-expected.js';

function setup(overrides: { branchExists?: boolean; fetch?: unknown; gate?: unknown; checkout?: unknown; prepare?: CheckoutStep<string, string> } = {}) {
  const events: string[] = [];
  const git = {
    assertAllowedBranch: vi.fn(async () => {
      events.push('gate');
      return overrides.gate ?? ok(undefined);
    }),
    branchExistsLocally: vi.fn(async () => {
      events.push('exists');
      return ok(overrides.branchExists ?? true);
    }),
    fetch: vi.fn(async () => {
      events.push('fetch');
      return overrides.fetch ?? ok(undefined);
    }),
    checkout: vi.fn(async () => {
      events.push('checkout');
      return overrides.checkout ?? ok(undefined);
    }),
  } as unknown as GitPort;
  const prepare = vi.fn(async () => {
    events.push('prepare');
    return overrides.prepare ?? { ok: true as const, value: 'prepared' };
  });
  const onResolveFailed = vi.fn((error: ResultError) => `resolve:${error.code}`);
  const onCheckoutFailed = vi.fn(async (prepared: string, error: ResultError) => {
    events.push('undo');
    return `undo:${prepared}:${error.code}`;
  });
  const run = (kind: 'member' | 'shared' = 'member') =>
    checkoutExpectedBranch({
      git,
      repoPath: '/r/a',
      spec: kind === 'member' ? { kind, branch: 'feat/a', edtUlid: 'e1' } : { kind, branch: 'develop' },
      prepare,
      onResolveFailed,
      onCheckoutFailed,
    });
  return { run, git, events, prepare, onResolveFailed, onCheckoutFailed };
}

describe('checkoutExpectedBranch', () => {
  it('resolves (gate, existence) then prepares then checks out, returning the prepared value', async () => {
    const { run, git, events } = setup();

    expect(await run()).toEqual({ ok: true, value: 'prepared' });
    expect(events).toEqual(['gate', 'exists', 'prepare', 'checkout']);
    expect(git.assertAllowedBranch).toHaveBeenCalledWith('/r/a', 'feat/a', 'e1');
    expect(git.checkout).toHaveBeenCalledWith('/r/a', 'feat/a');
  });

  it('fetches an absent shared branch before preparing', async () => {
    const { run, events } = setup({ branchExists: false });

    expect(await run('shared')).toEqual({ ok: true, value: 'prepared' });
    expect(events).toEqual(['exists', 'fetch', 'prepare', 'checkout']);
  });

  it('stops at a failed resolution without preparing or checking out', async () => {
    const gated = setup({ gate: err('branch-not-allowed', 'no') });
    expect(await gated.run()).toEqual({ ok: false, row: 'resolve:branch-not-allowed' });
    expect(gated.events).toEqual(['gate']);

    const missing = setup({ branchExists: false });
    expect(await missing.run()).toEqual({ ok: false, row: 'resolve:member-branch-missing' });
    expect(missing.prepare).not.toHaveBeenCalled();
  });

  it('returns a failed preparation as-is without checking out', async () => {
    const { run, git, onCheckoutFailed } = setup({ prepare: { ok: false, row: 'dirty' } });

    expect(await run()).toEqual({ ok: false, row: 'dirty' });
    expect(git.checkout).not.toHaveBeenCalled();
    expect(onCheckoutFailed).not.toHaveBeenCalled();
  });

  it('hands the prepared value and the checkout error to the undo path', async () => {
    const { run, events, onCheckoutFailed } = setup({ checkout: err('git-checkout-error', 'refused') });

    expect(await run()).toEqual({ ok: false, row: 'undo:prepared:git-checkout-error' });
    expect(onCheckoutFailed).toHaveBeenCalledWith('prepared', { code: 'git-checkout-error', message: 'refused' });
    expect(events).toEqual(['gate', 'exists', 'prepare', 'checkout', 'undo']);
  });

  it('skips the checkout, after preparing, when skipCheckout resolves true', async () => {
    const { git, events, prepare, onCheckoutFailed } = setup();
    const skipCheckout = vi.fn(async () => true);

    const result = await checkoutExpectedBranch({
      git,
      repoPath: '/r/a',
      spec: { kind: 'shared', branch: 'develop' },
      prepare,
      skipCheckout,
      onResolveFailed: () => 'x',
      onCheckoutFailed,
    });

    expect(result).toEqual({ ok: true, value: 'prepared' });
    expect(skipCheckout).toHaveBeenCalledWith('prepared');
    expect(events).toEqual(['exists', 'prepare']);
    expect(git.checkout).not.toHaveBeenCalled();
  });
});

describe('memberTargetSpec (AD-8 carve-out)', () => {
  it('gives the system shared-branches EDT the ungated shared spec', () => {
    expect(memberTargetSpec('01SHAREDBRANCHES0000000000', 'development')).toEqual({ kind: 'shared', branch: 'development' });
  });

  it('keeps the gated member spec for an ordinary EDT', () => {
    expect(memberTargetSpec('01ORDINARY', 'development')).toEqual({ kind: 'member', branch: 'development', edtUlid: '01ORDINARY' });
  });

  it('system members check out a shared branch without the gate, fetching it when absent; an ordinary EDT is rejected', async () => {
    const gate = err('shared-branch-rejected', 'protected');
    const system = setup({ branchExists: false, gate });
    const systemResult = await checkoutExpectedBranch({
      git: system.git, repoPath: '/r/a', spec: memberTargetSpec('01SHAREDBRANCHES0000000000', 'development'),
      prepare: system.prepare, onResolveFailed: system.onResolveFailed, onCheckoutFailed: system.onCheckoutFailed,
    });
    expect(systemResult.ok).toBe(true);
    expect(system.git.assertAllowedBranch).not.toHaveBeenCalled();
    expect(system.events).toEqual(['exists', 'fetch', 'prepare', 'checkout']);

    const ordinary = setup({ gate });
    const ordinaryResult = await checkoutExpectedBranch({
      git: ordinary.git, repoPath: '/r/a', spec: memberTargetSpec('01ORDINARY', 'development'),
      prepare: ordinary.prepare, onResolveFailed: ordinary.onResolveFailed, onCheckoutFailed: ordinary.onCheckoutFailed,
    });
    expect(ordinaryResult).toEqual({ ok: false, row: 'resolve:shared-branch-rejected' });
    expect(ordinary.git.checkout).not.toHaveBeenCalled();
  });
});
