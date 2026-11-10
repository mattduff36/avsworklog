/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixerrorsControlPanel } from '@/app/(dashboard)/debug/components/FixerrorsControlPanel';
import { FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PRODUCTION_ORIGIN, publicQueueState } from '@/lib/fixerrors/protocol';
import { checkEvidenceDigest } from '@/lib/fixerrors/control';
import { FixtureStore, harness, now } from '../unit/fixerrors-control-fixtures';

const auth = vi.hoisted(() => ({ isActualSuperAdmin: true, isViewingAs: false }));
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
beforeEach(() => {
  auth.isActualSuperAdmin = true;
  auth.isViewingAs = false;
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Debug local Fixerrors controls', () => {
  it('hides all controls for non-SuperAdmin and View As, without fetching', () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    auth.isActualSuperAdmin = false;
    const { rerender } = render(<FixerrorsControlPanel />);
    expect(screen.queryByText('Fixerrors companion')).toBeNull();
    auth.isActualSuperAdmin = true;
    auth.isViewingAs = true;
    rerender(<FixerrorsControlPanel />);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('shows a default disabled state with no job or deploy action', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, json: async () => ({ enabled: false, executionAvailable: false, origin: FIXERRORS_LOCAL_ORIGIN, devices: [], jobs: [] }),
    })));
    render(<FixerrorsControlPanel />);
    await screen.findByText(/Disabled by default/);
    expect(screen.queryByRole('button', { name: 'Request bounded repair' })).toBeNull();
  });

  it('accepts an available production bridge without granting deployment approval', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => snapshot }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await screen.findByText(/A device has reported bridge availability/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Confirm Deploy for exact candidate' })).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('records no deploy approval until the unchecked separate confirmation is checked and submitted, defaulting full', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    const repairId = await h.testedRepair();
    const snapshot = { enabled: true, executionAvailable: false, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => snapshot }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deploy: review exact candidate' }));
    expect(fetcher).toHaveBeenCalledTimes(1);
    const confirm = screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    const consent = screen.getByRole('checkbox', { name: /I approve deploying this exact tested candidate/ });
    expect(consent.getAttribute('aria-checked')).toBe('false');
    fireEvent.submit(confirm.closest('form')!);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(confirm.disabled).toBe(true);
    expect((screen.getByRole('radio', { name: /Full checks/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(consent);
    fireEvent.click(confirm);
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const calls = vi.mocked(fetch).mock.calls;
    const posted = calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({
      op: 'approve-deploy', repairJobId: repairId, candidate: store.state.jobs[0].candidate,
      confirmation: true, releaseMode: 'full',
    });
  });

  it('displays the signed worker and prepared-evidence digests in the separate confirmation without posting extra fields', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.testedRepair();
    const job = store.state.jobs[0];
    if (!job.checks || !job.candidate) throw new Error('Missing fixture evidence');
    job.checks.release = { candidateSha256: '8'.repeat(64), testEvidenceSha256: '9'.repeat(64) };
    job.candidate.checksSha256 = checkEvidenceDigest(job.checks);
    const snapshot = { enabled: true, executionAvailable: false, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => snapshot }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deploy: review exact candidate' }));
    expect(screen.getAllByText(/Worker candidate SHA-256/)).toHaveLength(2);
    expect(screen.getAllByText(/Prepared evidence SHA-256/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying this exact tested candidate/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const posted = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).not.toHaveProperty('release');
  });

  it('resets checkbox consent on mode changes and cancel/reopen; posts the explicit urgent mode', async () => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => snapshot }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    const open = await screen.findByRole('button', { name: 'Deploy: review exact candidate' });
    fireEvent.click(open);
    const consent = () => screen.getByRole('checkbox', { name: /I approve deploying this exact tested candidate/ });
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('radio', { name: /Targeted checks/ }));
    expect(consent().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(open);
    expect(consent().getAttribute('aria-checked')).toBe('false');
    expect((screen.getByRole('radio', { name: /Full checks/ }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Targeted checks/ }));
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }));
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
    const posted = vi.mocked(fetch).mock.calls.find((call) => call[1]?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({ confirmation: true, releaseMode: 'targeted' });
    expect(screen.queryByText(/current executor refuses/)).toBeNull();
  });

  it.each(['head', 'tree', 'checksSha256'] as const)('invalidates open consent after refreshed candidate %s changes', async (field) => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const snapshot = () => ({ enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot() })));
    render(<FixerrorsControlPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deploy: review exact candidate' }));
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying this exact tested candidate/ }));
    store.state.jobs[0].candidate = { ...store.state.jobs[0].candidate!, [field]: 'f'.repeat(field === 'checksSha256' ? 64 : 40) };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Deploy: review exact candidate' }));
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
  });

  it('clears consent when controls become unavailable or authorization changes', async () => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    let enabled = true;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      enabled, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
    }) })));
    const view = render(<FixerrorsControlPanel />);
    fireEvent.click(await screen.findByRole('button', { name: 'Deploy: review exact candidate' }));
    fireEvent.click(screen.getByRole('checkbox'));
    enabled = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    enabled = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Deploy: review exact candidate' }));
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('checkbox'));
    auth.isViewingAs = true;
    view.rerender(<FixerrorsControlPanel />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    await act(async () => {
      auth.isViewingAs = false;
      view.rerender(<FixerrorsControlPanel />);
    });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
