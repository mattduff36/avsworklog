/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deploymentEstimate, FixerrorsDeploymentProgress } from '@/app/(dashboard)/debug/components/FixerrorsDeploymentProgress';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Automatic deployment estimate', () => {
  it.each(['targeted', 'full'] as const)('reserves four minutes for the %s build and caps unconfirmed progress at 90', mode => {
    const start = deploymentEstimate(mode, 0, true, false);
    expect(start).toBeGreaterThan(0);
    expect(deploymentEstimate(mode, 120_000, true, false)).toBeCloseTo((start + 90) / 2);
    expect(deploymentEstimate(mode, 240_000, true, false)).toBe(90);
    expect(deploymentEstimate(mode, 600_000, true, false)).toBe(90);
    expect(deploymentEstimate(mode, 1, true, true)).toBe(100);
  });

  it('allows two minutes for focused final checks and eight for full checks without pretending approval happened', () => {
    expect(deploymentEstimate('targeted', 120_000, false, false)).toBe(30);
    expect(deploymentEstimate('full', 120_000, false, false)).toBe(15);
    expect(deploymentEstimate('full', 480_000, false, false)).toBe(60);
    expect(deploymentEstimate('targeted', 9_999_999, false, false)).toBe(30);
    expect(deploymentEstimate('targeted', -20, false, false)).toBe(0);
  });

  it('animates then waits at 90 until a confirmed deployed receipt arrives', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T21:00:00Z'));
    const release = { state: 'leased', createdAt: Date.now() };
    const view = render(<FixerrorsDeploymentProgress mode="targeted" release={release} permission="consumed" stale={false} />);
    const bar = () => screen.getByRole('progressbar', { name: 'Automatic deployment estimate' });
    expect(bar().getAttribute('aria-valuenow')).toBe('30');
    act(() => vi.advanceTimersByTime(120_000));
    expect(bar().getAttribute('aria-valuenow')).toBe('60');
    act(() => vi.advanceTimersByTime(180_000));
    expect(bar().getAttribute('aria-valuenow')).toBe('90');
    expect(screen.getByText(/taking longer than estimated/)).toBeDefined();
    view.rerender(<FixerrorsDeploymentProgress mode="targeted" release={{ ...release, state: 'deployed' }} permission="consumed" stale={false} />);
    expect(bar().getAttribute('aria-valuenow')).toBe('100');
    expect(screen.getByText('Deployment confirmed live')).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['failed', 'unknown', 'expired', 'paused'])('never reports success for a %s release', state => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T21:00:00Z'));
    render(<FixerrorsDeploymentProgress mode="targeted" release={{ state, createdAt: Date.now() - 600_000 }} permission="consumed" stale={false} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('90');
    expect(screen.getByText(/stopped or unconfirmed/)).toBeDefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('freezes on stale status, resumes on recovery, and cleans up on unmount', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-12T21:00:00Z'));
    const release = { state: 'leased', createdAt: Date.now() };
    const view = render(<FixerrorsDeploymentProgress mode="targeted" release={release} permission="consumed" stale={false} />);
    act(() => vi.advanceTimersByTime(60_000));
    view.rerender(<FixerrorsDeploymentProgress mode="targeted" release={release} permission="consumed" stale />);
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('45');
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<FixerrorsDeploymentProgress mode="targeted" release={release} permission="consumed" stale={false} />);
    act(() => vi.advanceTimersByTime(1_000));
    expect(Number(screen.getByRole('progressbar').getAttribute('aria-valuenow'))).toBeGreaterThanOrEqual(60);
    view.unmount(); expect(vi.getTimerCount()).toBe(0);
  });
});
