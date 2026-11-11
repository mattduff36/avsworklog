/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixerrorsControlPanel } from '@/app/(dashboard)/debug/components/FixerrorsControlPanel';
import { toast } from 'sonner';
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

async function openDetails(view: 'Activity' | 'History' | 'Runner settings') {
  await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${view}`) }));
}

async function openDeploy() {
  await openDetails('Activity');
  fireEvent.click(await screen.findByRole('button', { name: 'Deploy: review exact candidate' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Separate Deploy confirmation' })).toBeDefined();
}

function closeDetails() {
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
}

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
    await openDetails('Runner settings');
    await screen.findByText(/Disabled by default/);
    closeDetails();
    expect((screen.getByRole('button', { name: 'Run batch' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('enables fresh requests when connected without a packet and reports no-work honestly', async () => {
    const store = new FixtureStore();
    const device = store.state.devices[0];
    device.checkout = { head: device.workspace!.head, tree: device.workspace!.tree, clean: true };
    device.workspace = null;
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true, noWork: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDetails('Runner settings');
    await screen.findByText('Runner: Connected - waiting');
    closeDetails();
    const review = screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement;
    expect(review.disabled).toBe(false);
    fireEvent.click(review);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('No active untriaged or outstanding errors; no worker launched'));
    const posted = fetcher.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({ op: 'enqueue', action: 'review' });
    expect(screen.queryByRole('button', { name: 'Confirm Deploy for exact candidate' })).toBeNull();
  });

  it.each(['packet-needs-reconciliation', 'prepared-candidate'] as const)('disables fresh requests while runner is held: %s', async holdReason => {
    const store = new FixtureStore();
    store.state.devices[0].holdReason = holdReason;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
    }) })));
    render(<FixerrorsControlPanel />);
    await openDetails('Runner settings');
    await screen.findByText(`Runner: ${holdReason}`);
    closeDetails();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Run batch' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([true, false])('requests a fresh full batch instead of reusing an old single-packet review: %s', async evidenceAvailable => {
    const store = new FixtureStore();
    const h = harness(store);
    const id = await h.enqueue('review');
    const claim = await h.claim();
    await h.device({ op: 'complete', jobId: id, leaseToken: claim.leaseToken, result: { status: 'reviewed' } });
    if (evidenceAvailable) store.state.jobs[0].packet = 'Synthetic private fixture evidence';
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await screen.findByText('Online');
    fireEvent.click(screen.getByRole('button', { name: 'Run batch' }));
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    const posted = fetcher.mock.calls.find(call => call[1]?.method === 'POST');
    const body = JSON.parse(String(posted?.[1]?.body));
    expect(body).not.toHaveProperty('reviewJobId');
    expect(body).toMatchObject({ op: 'enqueue', action: 'repair' });
  });

  it('accepts an available production bridge without granting deployment approval', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDetails('Runner settings');
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
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDeploy();
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
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({
      op: 'approve-deploy', repairJobId: repairId, candidate: store.state.jobs[0].candidate,
      confirmation: true, releaseMode: 'full', requestId: expect.any(String),
    });
  });

  it.each([false, true])('gates a fresh run on completed lifecycle evidence, not a cancelled partial batch: %s', async required => {
    const store = new FixtureStore();
    await harness(store).enqueue();
    store.state.jobs[0].state = 'blocked';
    store.state.jobs[0].reason = 'local-opt-out';
    store.state.jobs[0].batch = { captured: 7, rows: 7, processed: 3, remaining: 4,
      counts: { 'verified-local': 0, held: 3, 'report-only': 0, failed: 0 }, lifecycle: 'pending' };
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    expect(snapshot.jobs[0].lifecycleReconciliationRequired).toBe(false);
    snapshot.jobs[0].lifecycleReconciliationRequired = required;
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    render(<FixerrorsControlPanel />);
    await screen.findByText('Online');
    const button = screen.getByRole('button', { name: 'Run batch' }) as HTMLButtonElement;
    expect(button.disabled).toBe(required);
  });

  it('collapses superseded partial attempts but keeps genuinely unresolved completed receipts visible', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    await h.enqueue();
    const old = store.state.jobs[0];
    old.state = 'failed'; old.createdAt = now - 1000;
    old.batch = { captured: 7, rows: 7, processed: 1, remaining: 6,
      counts: { 'verified-local': 0, held: 1, 'report-only': 0, failed: 0 }, lifecycle: 'pending' };
    await h.enqueue();
    const latest = store.state.jobs[1];
    latest.state = 'no-change';
    latest.batch = { captured: 7, rows: 7, processed: 7, remaining: 0,
      counts: { 'verified-local': 0, held: 7, 'report-only': 0, failed: 0 }, lifecycle: 'applied' };
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    await screen.findByText('7 / 7 cases processed; 0 remaining (7 error rows captured).');
    expect(screen.queryByText('1 / 7 cases processed; 6 remaining (7 error rows captured).')).toBeNull();
    closeDetails();
    await openDetails('History');
    expect(screen.getByText('1 / 7 cases processed; 6 remaining (7 error rows captured).')).toBeDefined();
    cleanup();
    snapshot.jobs.find(job => job.id === old.id)!.lifecycleReconciliationRequired = true;
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    await screen.findByText('1 / 7 cases processed; 6 remaining (7 error rows captured).');
  });

  it('keeps paused batch coverage visible and sends cancellation for only that run', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    const id = await h.enqueue();
    store.state.jobs[0].state = 'paused';
    store.state.jobs[0].batch = { captured: 4, rows: 281, processed: 2, remaining: 2,
      counts: { 'verified-local': 1, held: 1, 'report-only': 0, failed: 0 }, lifecycle: 'pending' };
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    await screen.findByText('2 / 4 cases processed; 2 remaining (281 error rows captured).');
    expect(screen.getByText(/1 verified locally \/ 1 held/)).toBeDefined();
    expect(screen.getByText(/Lifecycle: pending.*not confirmed reconciled/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel run' }));
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    const posted = fetcher.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toEqual({ op: 'cancel', jobId: id });
  });

  it.each(['pending', 'blocked', 'applied'] as const)('gates tested batch Deploy on exact-row lifecycle state: %s', async lifecycle => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    store.state.jobs[0].batch = { captured: 4, rows: 281, processed: 4, remaining: 0,
      counts: { 'verified-local': 2, held: 2, 'report-only': 0, failed: 0 }, lifecycle,
      ...(lifecycle === 'blocked' ? { lifecycleReason: 'uncertain' as const } : {}) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
    }) })));
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    const deploy = await screen.findByRole('button', { name: 'Deploy: review exact candidate' }) as HTMLButtonElement;
    expect(deploy.disabled).toBe(lifecycle !== 'applied');
    if (lifecycle === 'blocked') expect(screen.getByText(/Lifecycle: blocked \(uncertain\)/)).toBeDefined();
    if (lifecycle === 'applied') expect(screen.getByText(/Local verification is not a live fix/)).toBeDefined();
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
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDeploy();
    expect(screen.getAllByText(/Worker candidate SHA-256/)).toHaveLength(1);
    expect(screen.getAllByText(/Prepared evidence SHA-256/)).toHaveLength(1);
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
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDeploy();
    const consent = () => screen.getByRole('checkbox', { name: /I approve deploying this exact tested candidate/ });
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('radio', { name: /Targeted checks/ }));
    expect(consent().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(consent());
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await openDeploy();
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
    await openDeploy();
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying this exact tested candidate/ }));
    store.state.jobs[0].candidate = { ...store.state.jobs[0].candidate!, [field]: 'f'.repeat(field === 'checksSha256' ? 64 : 40) };
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    await openDeploy();
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
    await openDeploy();
    fireEvent.click(screen.getByRole('checkbox'));
    enabled = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    enabled = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await screen.findByText('Online');
    await openDeploy();
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

it('shows all retained previous jobs in a separate History dialog and keeps uncertain work in Activity', async () => {
  const store = new FixtureStore();
  const h = harness(store);
  await h.enqueue('review');
  const template = store.state.jobs[0];
  store.state.jobs = Array.from({ length: 55 }, (_, index) => ({ ...template,
    id: crypto.randomUUID(), state: 'reviewed' as const, createdAt: now - index,
  }));
  store.state.jobs.push({ ...template, id: crypto.randomUUID(), state: 'unknown', reason: 'release-unconfirmed' });
  const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
  expect(snapshot.jobs).toHaveLength(56);
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
  render(<FixerrorsControlPanel />);
  const toggle = await screen.findByRole('button', { name: 'History (55)' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('reviewed')).toBeNull();
  await openDetails('Activity');
  expect(screen.getByText('unknown')).toBeTruthy();
  closeDetails();
  fireEvent.click(toggle);
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getAllByText('reviewed')).toHaveLength(55);
  closeDetails();
  expect(screen.queryByText('reviewed')).toBeNull();
});

describe('Compact companion dialogs and preserved states', () => {
  it.each(['Activity', 'History', 'Runner settings'] as const)('dismisses %s outside and with Escape without posting', async view => {
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(new FixtureStore().state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => snapshot }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    for (const method of ['outside', 'Escape']) {
      await openDetails(view);
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      await new Promise(resolve => setTimeout(resolve, 0));
      if (method === 'outside') fireEvent.pointerDown(document.body, { button: 0 });
      else fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: new RegExp(`^${view}`) })));
    }
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['Escape', 'outside', 'Close'] as const)('clears deployment consent and release mode after %s dismissal', async method => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => snapshot }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDeploy();
    fireEvent.click(screen.getByRole('radio', { name: /Targeted checks/ }));
    fireEvent.click(screen.getByRole('checkbox'));
    const dialog = screen.getByRole('dialog', { name: 'Separate Deploy confirmation' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    if (method === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    else if (method === 'outside') fireEvent.pointerDown(document.body, { button: 0 });
    else fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Activity (1)' })));
    await openDeploy();
    expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false');
    expect((screen.getByRole('radio', { name: /Full checks/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('preserves initial loading and disabled actions, then shows a failed refresh and recovers explicitly', async () => {
    let resolve!: (value: { ok: boolean }) => void;
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(new FixtureStore().state) };
    const fetcher = vi.fn()
      .mockImplementationOnce(() => new Promise(done => { resolve = done; }))
      .mockResolvedValue({ ok: true, json: async () => snapshot });
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    expect(screen.getByText('Loading...')).toBeDefined();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Runner settings' }));
    expect(screen.getByRole('dialog', { name: 'Fixerrors runner settings' })).toBeDefined();
    await act(async () => { resolve({ ok: false }); });
    expect(screen.getByRole('alert').textContent).toContain('Existing error logs are unaffected');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await screen.findByText('Runner: Connected - waiting');
    closeDetails();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['offline', 'future heartbeat', 'revoked', 'bridge unavailable', 'checkout unavailable', 'no devices'] as const)(
    'keeps enqueue actions disabled for %s', async state => {
      const store = new FixtureStore();
      const device = store.state.devices[0];
      if (state === 'offline') device.lastSeenAt = now - 45_001;
      if (state === 'future heartbeat') device.lastSeenAt = now + 1;
      if (state === 'revoked') device.revoked = true;
      if (state === 'bridge unavailable') device.bridgeAvailable = false;
      if (state === 'checkout unavailable') device.workspace = null;
      if (state === 'no devices') store.state.devices = [];
      const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
      render(<FixerrorsControlPanel />);
      await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull());
      expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole('button', { name: 'Run batch' }) as HTMLButtonElement).disabled).toBe(true);
      await openDetails('Runner settings');
      if (state === 'no devices') expect(screen.getByText('No enrolled devices.')).toBeDefined();
      if (state === 'bridge unavailable') expect(screen.getByText('Runner: bridge unavailable')).toBeDefined();
      if (state === 'checkout unavailable') expect(screen.getByText('Runner: checkout unavailable')).toBeDefined();
      if (state === 'revoked') expect((screen.getByRole('button', { name: 'Revoke device' }) as HTMLButtonElement).disabled).toBe(true);
    },
  );

  it.each(['allowReadOnly', 'allowRepair'] as const)('preserves independent local opt-in %s', async field => {
    const store = new FixtureStore();
    store.state.devices[0][field] = false;
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    render(<FixerrorsControlPanel />);
    await screen.findByText('Online');
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(field === 'allowReadOnly');
    expect((screen.getByRole('button', { name: 'Run batch' }) as HTMLButtonElement).disabled).toBe(field === 'allowRepair');
    await openDetails('Runner settings');
    expect(screen.getByText(field === 'allowReadOnly' ? 'Local opt-ins: review off / repair on / deploy on' : 'Local opt-ins: review on / repair off / deploy on')).toBeDefined();
  });

  it('retains multiple runners, selects the intended device for enqueue and revokes only that device', async () => {
    const store = new FixtureStore();
    const secondId = crypto.randomUUID();
    store.state.devices.push({ ...store.state.devices[0], id: secondId, name: 'Second runner', allowDeploy: false });
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDetails('Runner settings');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    const second = screen.getByRole('radio', { name: 'Use Second runner' });
    fireEvent.click(second);
    expect(screen.getByText('Local opt-ins: review on / repair on / deploy off')).toBeDefined();
    closeDetails();
    fireEvent.click(screen.getByRole('button', { name: 'Review' }));
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(fetcher.mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body))).toEqual({
      op: 'enqueue', deviceId: secondId, action: 'review', requestId: expect.any(String),
    });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false));
    await openDetails('Runner settings');
    const runner = screen.getByRole('radio', { name: 'Use Second runner' }).closest('.rounded-lg') as HTMLElement;
    fireEvent.click(within(runner).getByRole('button', { name: 'Revoke device' }));
    await waitFor(() => expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(2));
    const posts = fetcher.mock.calls.filter(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(posts[1][1]?.body))).toEqual({ op: 'revoke-device', deviceId: secondId });
  });

  it.each(['removed', 'revoked'] as const)('never silently switches the selected runner when it is %s during polling', async state => {
    const store = new FixtureStore();
    store.state.devices.push({ ...store.state.devices[0], id: crypto.randomUUID(), name: 'Other runner' });
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => structuredClone(snapshot) })));
    render(<FixerrorsControlPanel />);
    await screen.findByRole('status', { name: 'Proof fixture: Online' });
    if (state === 'removed') snapshot.devices.shift();
    else snapshot.devices[0].revoked = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await screen.findByText(state === 'removed' ? 'Runner unavailable' : 'Proof fixture: Revoked');
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Run batch' }) as HTMLButtonElement).disabled).toBe(true);
    await openDetails('Runner settings');
    fireEvent.click(screen.getByRole('radio', { name: 'Use Other runner' }));
    closeDetails();
    expect((screen.getByRole('button', { name: 'Review' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['reconciliation', 'lifecycle', 'existing release', 'missing repair'] as const)('invalidates an open deployment decision after %s changes', async change => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => structuredClone(snapshot) }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDeploy();
    fireEvent.click(screen.getByRole('checkbox'));
    if (change === 'reconciliation') snapshot.releaseNeedsReconciliation = true;
    if (change === 'lifecycle') snapshot.jobs[0].batch = { captured: 1, rows: 1, processed: 1, remaining: 0,
      counts: { 'verified-local': 1, held: 0, 'report-only': 0, failed: 0 }, lifecycle: 'pending' };
    if (change === 'existing release') snapshot.jobs.push({ ...snapshot.jobs[0], id: crypto.randomUUID(), action: 'deploy', parentRepairId: snapshot.jobs[0].id });
    if (change === 'missing repair') snapshot.jobs = [];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await waitFor(() => expect(screen.queryByRole('checkbox')).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (change === 'reconciliation') {
      expect(screen.getByRole('alert').textContent).toContain('Deployment result unknown');
      expect((screen.getByRole('button', { name: 'Run batch' }) as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it('shows a rejected approval without success and preserves busy/disabled submission gates', async () => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    let rejectApproval!: (value: { ok: boolean; json: () => Promise<{ error: string }> }) => void;
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      if (options?.method === 'POST') return new Promise(resolve => { rejectApproval = resolve; });
      return { ok: true, json: async () => snapshot };
    });
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDeploy();
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }));
    const submitting = screen.getByRole('button', { name: 'Recording approval...' }) as HTMLButtonElement;
    expect(submitting.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('checkbox').getAttribute('data-disabled')).not.toBeNull();
    await act(async () => { rejectApproval({ ok: false, json: async () => ({ error: 'candidate changed' }) }); });
    expect(toast.error).toHaveBeenCalledWith('candidate changed');
    expect(screen.getByRole('dialog', { name: 'Separate Deploy confirmation' })).toBeDefined();
    expect((screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }) as HTMLButtonElement).disabled).toBe(false);
  });
});
