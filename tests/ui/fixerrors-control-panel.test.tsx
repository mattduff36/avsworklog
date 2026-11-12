/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentProps, CSSProperties } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FixerrorsControlPanel } from '@/app/(dashboard)/debug/components/FixerrorsControlPanel';
import { toast } from 'sonner';
import { adminCommandSchema, FIXERRORS_LOCAL_ORIGIN, FIXERRORS_PRODUCTION_ORIGIN, publicQueueState } from '@/lib/fixerrors/protocol';
import { applyAdminCommand, checkEvidenceDigest } from '@/lib/fixerrors/control';
import { actorId, candidate, checks, FixtureStore, harness, now, workspace } from '../unit/fixerrors-control-fixtures';
import { capturedBatch } from '../unit/fixerrors-batch-fixtures';

const auth = vi.hoisted(() => ({ isActualSuperAdmin: true, isViewingAs: false }));
const dialogContentProps = vi.hoisted(() => vi.fn<(props: { className?: string; style?: CSSProperties }) => void>());
vi.mock('@/lib/hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/components/ui/dialog', async importOriginal => {
  const dialog = await importOriginal<typeof import('@/components/ui/dialog')>();
  return {
    ...dialog,
    DialogContent: (props: ComponentProps<typeof dialog.DialogContent>) => {
      dialogContentProps(props);
      return <dialog.DialogContent {...props} />;
    },
  };
});
beforeEach(() => {
  auth.isActualSuperAdmin = true;
  auth.isViewingAs = false;
  dialogContentProps.mockClear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function openDetails(view: 'Activity' | 'Runner settings') {
  await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Run Fixerrors' }));
  if (view === 'Runner settings' && screen.queryByText('Runner settings', { selector: 'summary' })) {
    fireEvent.click(screen.getByText('Runner settings', { selector: 'summary' }));
  }
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

function filterActivity(filter: 'All' | 'Needs attention' | 'Previous') {
  const filters = screen.getByRole('group', { name: 'Activity filters' });
  const button = within(filters).getByRole('button', { name: new RegExp(`^${filter} \\(`) });
  fireEvent.click(button);
  expect(button.getAttribute('aria-pressed')).toBe('true');
}

function activityRows() {
  return within(screen.getByRole('table', { name: 'Fixerrors activity runs' })).getAllByRole('row').slice(1);
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
    expect(screen.queryByRole('button', { name: 'Start review and repair' })).toBeNull();
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
    const review = screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement;
    expect(review.disabled).toBe(false);
    fireEvent.click(review);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('No active untriaged or outstanding errors; no worker launched'));
    const posted = fetcher.mock.calls.find(call => call[1]?.method === 'POST');
    expect(JSON.parse(String(posted?.[1]?.body))).toMatchObject({ op: 'enqueue', action: 'repair' });
    expect(screen.getByText('No eligible errors; no worker launched.')).toBeDefined();
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
    expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it.each([true, false])('starts a fresh review instead of reusing an old single-packet review: %s', async evidenceAvailable => {
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
    await openDetails('Activity');
    fireEvent.click(screen.getByRole('button', { name: 'Start review and repair' }));
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
    await openDetails('Activity');
    const button = screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement;
    expect(button.disabled).toBe(required);
  });

  it('keeps superseded attempts in All and Previous, and unresolved receipts in Needs attention', async () => {
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
    expect(screen.getByText('1 / 7 cases processed; 6 remaining (7 error rows captured).')).toBeDefined();
    filterActivity('Needs attention');
    expect(screen.queryByText('1 / 7 cases processed; 6 remaining (7 error rows captured).')).toBeNull();
    filterActivity('Previous');
    expect(screen.getByText('1 / 7 cases processed; 6 remaining (7 error rows captured).')).toBeDefined();
    cleanup();
    snapshot.jobs.find(job => job.id === old.id)!.lifecycleReconciliationRequired = true;
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    filterActivity('Needs attention');
    await screen.findByText('1 / 7 cases processed; 6 remaining (7 error rows captured).');
  });

  it('explains a provider spending limit without suggesting the investigation succeeded', async () => {
    const store = new FixtureStore();
    await harness(store).enqueue();
    store.state.jobs[0].state = 'failed';
    store.state.jobs[0].batch = { captured: 1, rows: 1, processed: 1, remaining: 0,
      counts: { 'verified-local': 0, held: 0, 'report-only': 0, failed: 1 }, lifecycle: 'applied',
      latest: { importance: 'Important', reason: 'impact-uncertain', effort: 'focused', route: 'failed',
        diagnostic: 'worker-provider-limit', analysisMs: 20, repairAndChecksMs: 0, totalMs: 30 } };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
      enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
    }) })));
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    expect(await screen.findByText(/The worker could not investigate: the AI provider spending limit/)).toBeDefined();
    expect(screen.getByText(/0 verified locally \/ 0 held \/ 0 report only \/ 1 failed/)).toBeDefined();
    expect(screen.queryByText(/Effort is guidance/)).toBeNull();
  });

  it('keeps paused batch coverage visible and sends cancellation for only that run', async () => {
    const store = new FixtureStore();
    const h = harness(store);
    const id = await h.enqueue();
    store.state.jobs[0].state = 'paused';
    store.state.jobs[0].batch = { captured: 4, rows: 281, processed: 2, remaining: 2,
      counts: { 'verified-local': 1, held: 1, 'report-only': 0, failed: 0 }, lifecycle: 'pending',
      triage: { Routine: 0, Important: 2, Urgent: 0 },
      latest: { importance: 'Important', reason: 'impact-uncertain', effort: 'focused', route: 'deployment-verification',
        analysisMs: 0, repairAndChecksMs: 0, totalMs: 2 } };
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
    expect(screen.getByText(/0 Routine \/ 2 Important \/ 0 Urgent/)).toBeDefined();
    expect(screen.getByText(/Latest: Important.*deployment verification/)).toBeDefined();
    expect(screen.getByText(/Measured analysis 0 ms.*case total 2 ms/)).toBeDefined();
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
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull());
    await openDeploy();
    expect(screen.getByRole('checkbox', { name: /I approve deploying/ }).getAttribute('aria-checked')).toBe('false');
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
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying/ }));
    enabled = false;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull());
    enabled = true;
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await screen.findByText('Online');
    await openDeploy();
    expect(screen.getByRole('checkbox', { name: /I approve deploying/ }).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying/ }));
    auth.isViewingAs = true;
    view.rerender(<FixerrorsControlPanel />);
    expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull();
    await act(async () => {
      auth.isViewingAs = false;
      view.rerender(<FixerrorsControlPanel />);
    });
    expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull();
  });
});

it('shows all retained jobs once in one Activity log, attention first and previous newest-first, with counted filters reset on reopen', async () => {
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
  const toggle = await screen.findByRole('button', { name: 'Run Fixerrors' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('button', { name: /^History/ })).toBeNull();
  expect(screen.queryByText('reviewed')).toBeNull();
  await openDetails('Activity');
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(screen.getByRole('dialog', { name: 'Fixerrors control centre' })).toBeDefined();
  expect(toggle.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('button', { name: 'All (56)' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('button', { name: 'Needs attention (1)' })).toBeDefined();
  expect(screen.getByRole('button', { name: 'Previous (55)' })).toBeDefined();
  expect(screen.getByText('unknown')).toBeTruthy();
  expect(screen.getAllByText('reviewed')).toHaveLength(55);
  const orderedIds = [store.state.jobs[55].id, ...store.state.jobs.slice(0, 55).map(job => job.id)];
  const expectRows = (ids: string[]) => {
    const rows = activityRows();
    expect(rows).toHaveLength(ids.length);
    rows.forEach((row, index) => expect(within(row).getByText(ids[index])).toBeDefined());
  };
  expectRows(orderedIds);
  filterActivity('Needs attention');
  expectRows(orderedIds.slice(0, 1));
  expect(screen.queryByText('reviewed')).toBeNull();
  filterActivity('Previous');
  expectRows(orderedIds.slice(1));
  expect(screen.queryByText('unknown')).toBeNull();
  filterActivity('All');
  expectRows(orderedIds);
  filterActivity('Previous');
  closeDetails();
  await openDetails('Activity');
  expect(screen.getByRole('button', { name: 'All (56)' }).getAttribute('aria-pressed')).toBe('true');
  expectRows(orderedIds);
  closeDetails();
  expect(screen.queryByText('reviewed')).toBeNull();
  expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
});

describe('Compact companion dialogs and preserved states', () => {
  it.each(['full', 'targeted'] as const)('keeps mixed runs complete in labelled responsive columns, with one copy of each action and %s approval details', async releaseMode => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const template = store.state.jobs[0];
    if (!template.candidate || !template.checks) throw new Error('Missing fixture candidate');
    template.checks.release = { candidateSha256: '8'.repeat(64), testEvidenceSha256: '9'.repeat(64) };
    template.createdAt = now - 4000;
    const paused = { ...template, id: crypto.randomUUID(), createdAt: now - 3000, state: 'paused' as const, candidate: null, checks: null,
      batch: { captured: 4, rows: 281, processed: 2, remaining: 2,
        counts: { 'verified-local': 1, held: 1, 'report-only': 0, failed: 0 }, lifecycle: 'pending' as const } };
    const deployed = { ...template, id: crypto.randomUUID(), createdAt: now - 2000, action: 'deploy' as const, state: 'deployed' as const,
      parentRepairId: crypto.randomUUID(), approval: { actorId: template.requestedBy, candidate: template.candidate, confirmedAt: now - 2500, releaseMode } };
    const failed = { ...template, id: crypto.randomUUID(), createdAt: now - 1000, state: 'failed' as const, reason: 'execution-failed' as const, candidate: null, checks: null };
    const reviewed = { ...template, id: crypto.randomUUID(), createdAt: now, action: 'review' as const, state: 'reviewed' as const, candidate: null, checks: null };
    store.state.jobs = [failed, template, reviewed, paused, deployed];
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    const table = screen.getByRole('table', { name: 'Fixerrors activity runs' });
    const labels = ['Run/date', 'Status', 'Runner', 'Progress/result', 'Actions/details'];
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(labels);
    const rows = activityRows();
    const expectedIds = [paused.id, template.id, reviewed.id, failed.id, deployed.id];
    expect(rows).toHaveLength(expectedIds.length);
    expect(table.className).toContain('[overflow-wrap:anywhere]');
    rows.forEach((row, index) => {
      expect(within(row).getByText(expectedIds[index])).toBeDefined();
      expect(row.className).toContain('grid-cols-1');
      expect(row.className).toContain('lg:grid-cols-[minmax(0,1fr)');
      const cells = within(row).getAllByRole('cell');
      expect(cells).toHaveLength(5);
      cells.forEach((cell, column) => {
        expect(cell.className).toContain('min-w-0');
        expect(within(cell).getByText(labels[column]).className).toContain('lg:hidden');
      });
    });
    expect(within(rows[0]).getByText('2 / 4 cases processed; 2 remaining (281 error rows captured).')).toBeDefined();
    expect(within(rows[0]).getByText(/1 verified locally \/ 1 held/)).toBeDefined();
    expect(within(rows[0]).getByText(/Lifecycle: pending.*not confirmed reconciled/)).toBeDefined();
    expect(within(rows[3]).getByText('execution-failed')).toBeDefined();
    expect(within(rows[4]).getByText(`${releaseMode === 'full' ? 'Full checks (fap)' : 'Targeted checks (urgent)'} / separately confirmed ${new Date(deployed.approval.confirmedAt).toLocaleString('en-GB')}`)).toBeDefined();
    expect(within(rows[1]).getByText('Technical candidate details')).toBeDefined();
    expect(within(rows[1]).getByText(/Checks SHA-256/).textContent).toContain(template.candidate.checksSha256);
    expect(within(rows[1]).getByText(/Worker candidate SHA-256/).textContent).toContain('8'.repeat(64));
    expect(within(rows[1]).getByText(/Prepared evidence SHA-256/).textContent).toContain('9'.repeat(64));
    expect(screen.getAllByRole('button', { name: 'Cancel run', hidden: true })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Deploy: review exact candidate', hidden: true })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Needs attention (2)' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Previous (3)' })).toBeDefined();
    filterActivity('Previous');
    expect(activityRows()).toHaveLength(3);
    expect(screen.queryByRole('button', { name: 'Cancel run', hidden: true })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Deploy: review exact candidate', hidden: true })).toBeNull();
    filterActivity('All');
    expect(activityRows()).toHaveLength(5);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('uses consistent pixel and safe-area viewport bounds locally, keeping activity filters and refresh outside the scrolling entries', async () => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    render(<FixerrorsControlPanel />);
    const expectBounds = (dialog: HTMLElement, maxWidth: string) => {
      expect(dialog.className).toContain(maxWidth);
      expect(dialog.className).toContain('[--fixerrors-dialog-gutter:24px]');
      expect(dialog.className).toContain('md:[--fixerrors-dialog-gutter:48px]');
      expect(dialog.style.maxHeight).toContain('100dvh');
      expect(dialog.style.maxHeight).toContain('var(--fixerrors-dialog-gutter)');
      expect(dialog.style.maxHeight).toContain('env(safe-area-inset-top, 0px)');
      expect(dialog.style.maxHeight).toContain('env(safe-area-inset-bottom, 0px)');
      // Happy DOM drops nested CSS math for position/width; inspect props passed to the real dialog.
      const props = dialogContentProps.mock.calls.filter(([props]) =>
        props.className?.includes(maxWidth) && props.className.includes('overflow-hidden') === dialog.className.includes('overflow-hidden')).at(-1)?.[0];
      if (!props?.style) throw new Error('Missing dialog viewport style');
      expect(props.style.top).toContain('var(--fixerrors-dialog-gutter)');
      expect(props.style.top).toContain('env(safe-area-inset-top, 0px)');
      expect(props.style.top).toContain('env(safe-area-inset-bottom, 0px)');
      expect(props.style.left).toContain('var(--fixerrors-dialog-gutter)');
      expect(props.style.width).toContain('100vw');
      expect(props.style.width).toContain('env(safe-area-inset-left, 0px)');
      expect(props.style.width).toContain('env(safe-area-inset-right, 0px)');
    };
    await openDetails('Activity');
    expectBounds(screen.getByRole('dialog'), 'max-w-6xl');
    const entries = screen.getByLabelText('Activity entries');
    expect(entries.className).toContain('min-h-0');
    expect(entries.className).toContain('overflow-y-auto');
    expect(entries.className).toContain('overflow-x-hidden');
    expect(entries.contains(screen.getByRole('table'))).toBe(true);
    expect(entries.contains(screen.getByRole('group', { name: 'Activity filters' }))).toBe(false);
    expect(entries.contains(screen.getByRole('heading', { name: 'Fixerrors control centre' }))).toBe(false);
    expect(entries.contains(screen.getByRole('button', { name: 'Refresh companion state' }))).toBe(false);
    expect(entries.contains(screen.getByRole('button', { name: 'Close' }))).toBe(false);
    closeDetails();
    await openDetails('Runner settings');
    expectBounds(screen.getByRole('dialog'), 'max-w-6xl');
    closeDetails();
    await openDeploy();
    expectBounds(screen.getByRole('dialog'), 'max-w-4xl');
    expect(screen.getByRole('dialog').className).toContain('overflow-y-auto');
    expect(screen.getByRole('dialog').className).toContain('overflow-x-hidden');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('distinguishes empty All, Needs attention and Previous filters without changing queue state', async () => {
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(new FixtureStore().state) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    render(<FixerrorsControlPanel />);
    await openDetails('Activity');
    expect(screen.getByRole('button', { name: 'All (0)' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('No activity recorded.')).toBeDefined();
    filterActivity('Needs attention');
    expect(screen.getByText('No jobs need attention or deployment decisions.')).toBeDefined();
    filterActivity('Previous');
    expect(screen.getByText('No previous activity.')).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it.each(['Activity', 'Runner settings'] as const)('dismisses %s outside and with Escape without posting', async view => {
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
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Run Fixerrors' })));
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
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying/ }));
    const dialog = screen.getByRole('dialog', { name: 'Separate Deploy confirmation' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await new Promise(resolve => setTimeout(resolve, 0));
    if (method === 'Escape') fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    else if (method === 'outside') fireEvent.pointerDown(document.body, { button: 0 });
    else fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Run Fixerrors' })));
    await openDeploy();
    expect(screen.getByRole('checkbox', { name: /I approve deploying/ }).getAttribute('aria-checked')).toBe('false');
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
    fireEvent.click(screen.getByRole('button', { name: 'Run Fixerrors' }));
    expect(screen.getByRole('dialog', { name: 'Fixerrors control centre' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Start review and repair' })).toBeNull();
    await act(async () => { resolve({ ok: false }); });
    expect(screen.getByRole('alert').textContent).toContain('Existing error logs are unaffected');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await screen.findByRole('button', { name: 'Start review and repair' });
    fireEvent.click(screen.getByText('Runner settings', { selector: 'summary' }));
    await screen.findByText('Runner: Connected - waiting');
    expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(false);
    closeDetails();
    expect(screen.queryByRole('alert')).toBeNull();
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
      await openDetails('Runner settings');
      expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(true);
      if (state === 'no devices') expect(screen.getByText('No enrolled devices.')).toBeDefined();
      if (state === 'bridge unavailable') expect(screen.getByText('Runner: bridge unavailable')).toBeDefined();
      if (state === 'checkout unavailable') expect(screen.getByText('Runner: checkout unavailable')).toBeDefined();
      if (state === 'revoked') expect((screen.getByRole('button', { name: 'Revoke device' }) as HTMLButtonElement).disabled).toBe(true);
    },
  );

  it.each(['allowReadOnly', 'allowRepair', 'allowDeploy'] as const)('requires every independent D opt-in: %s', async field => {
    const store = new FixtureStore();
    store.state.devices[0][field] = false;
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => snapshot })));
    render(<FixerrorsControlPanel />);
    await openDetails('Runner settings');
    expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/D consent is required; no review-only fallback/)).toBeDefined();
    expect(screen.getByText(`Local opt-ins: review ${field === 'allowReadOnly' ? 'off' : 'on'} / repair ${field === 'allowRepair' ? 'off' : 'on'} / deploy ${field === 'allowDeploy' ? 'off' : 'on'}`)).toBeDefined();
  });

  it('retains multiple runners, selects the intended device for enqueue and revokes only that device', async () => {
    const store = new FixtureStore();
    const secondId = crypto.randomUUID();
    store.state.devices.push({ ...store.state.devices[0], id: secondId, name: 'Second runner' });
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
      ok: true, json: async () => options?.method === 'POST' ? { ok: true, noWork: true } : snapshot,
    }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDetails('Runner settings');
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    const second = screen.getByRole('radio', { name: 'Use Second runner' });
    fireEvent.click(second);
    expect((second as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start review and repair' }));
    await waitFor(() => expect(fetcher.mock.calls.some(call => call[1]?.method === 'POST')).toBe(true));
    expect(JSON.parse(String(fetcher.mock.calls.find(call => call[1]?.method === 'POST')?.[1]?.body))).toEqual({
      op: 'enqueue', deviceId: secondId, action: 'repair', requestId: expect.any(String), requestedReleaseMode: 'targeted',
    });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(false));
    const runner = screen.getByRole('radio', { name: 'Use Second runner' }).closest('.border-t') as HTMLElement;
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
    await openDetails('Runner settings');
    expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Use Other runner' }));
    expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it.each(['reconciliation', 'lifecycle', 'existing release', 'missing repair'] as const)('invalidates an open deployment decision after %s changes', async change => {
    const store = new FixtureStore();
    await harness(store).testedRepair();
    const snapshot = { enabled: true, executionAvailable: true, origin: FIXERRORS_LOCAL_ORIGIN, ...publicQueueState(store.state) };
    const fetcher = vi.fn(async () => ({ ok: true, json: async () => structuredClone(snapshot) }));
    vi.stubGlobal('fetch', fetcher);
    render(<FixerrorsControlPanel />);
    await openDeploy();
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying/ }));
    if (change === 'reconciliation') snapshot.releaseNeedsReconciliation = true;
    if (change === 'lifecycle') snapshot.jobs[0].batch = { captured: 1, rows: 1, processed: 1, remaining: 0,
      counts: { 'verified-local': 1, held: 0, 'report-only': 0, failed: 0 }, lifecycle: 'pending' };
    if (change === 'existing release') snapshot.jobs.push({ ...snapshot.jobs[0], id: crypto.randomUUID(), action: 'deploy', parentRepairId: snapshot.jobs[0].id });
    if (change === 'missing repair') snapshot.jobs = [];
    fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
    await waitFor(() => expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(2);
    if (change === 'reconciliation') {
      expect(screen.getByRole('alert').textContent).toContain('Deployment result unknown');
      await openDetails('Activity');
      expect((screen.getByRole('button', { name: 'Start review and repair' }) as HTMLButtonElement).disabled).toBe(true);
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
    fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }));
    const submitting = screen.getByRole('button', { name: 'Recording approval...' }) as HTMLButtonElement;
    expect(submitting.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('checkbox', { name: /I approve deploying/ }).getAttribute('data-disabled')).not.toBeNull();
    await act(async () => { rejectApproval({ ok: false, json: async () => ({ error: 'candidate changed' }) }); });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Refresh and inspect activity'));
    expect(screen.queryByText('candidate changed')).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Separate Deploy confirmation' })).toBeNull();
  });

  describe('Unified Fixerrors run and refresh safety', () => {
    function liveFixture() {
      const store = new FixtureStore();
      const h = harness(store);
      const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
        ok: true, json: async () => {
          if (options?.method !== 'POST') return {
            enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
          };
          const command = adminCommandSchema.parse(JSON.parse(String(options.body)));
          return command.op === 'enqueue' && command.autoDeployConfirmation
            ? store.transact(tx => applyAdminCommand(tx, actorId, command, now,
              { checkout: workspace, packet: null, batch: capturedBatch(command.requestId) }))
            : h.admin(command);
        },
      }));
      vi.stubGlobal('fetch', fetcher);
      const posts = () => fetcher.mock.calls.filter(call => call[1]?.method === 'POST').map(call => JSON.parse(String(call[1]?.body)));
      const start = async (full = false) => {
        render(<FixerrorsControlPanel />);
        await openDetails('Activity');
        expect(posts()).toEqual([]);
        expect(screen.getByRole('checkbox', { name: 'Run full checks (fap)' })).not.toBeChecked();
        if (full) fireEvent.click(screen.getByRole('checkbox', { name: 'Run full checks (fap)' }));
        fireEvent.click(screen.getByRole('button', { name: 'Start review and repair' }));
        await waitFor(() => expect(store.state.jobs).toHaveLength(1));
        await waitFor(() => expect(screen.queryByText('Recording request...')).toBeNull());
      };
      return { store, h, posts, start };
    }

    it.each(['targeted', 'full'] as const)('remembers the %s checkbox preference without granting Deploy consent', async mode => {
      const f = liveFixture();
      await f.start(mode === 'full');
      expect(f.store.state.jobs[0].requestedReleaseMode).toBe(mode);
      expect(f.store.state.jobs[0].approval).toBeNull();
      const claim = await f.h.claim();
      await f.h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken,
        result: { status: 'tested', candidate, checks } });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
      await screen.findByText('Deploy-ready: inspect the exact tested candidate and separately confirm Deploy.');
      fireEvent.click(screen.getByRole('button', { name: 'Deploy: review exact candidate' }));
      expect(screen.getByRole('radio', { name: mode === 'full' ? /Full checks/ : /Targeted checks/ })).toBeChecked();
      expect(screen.getByRole('checkbox', { name: /I approve deploying/ })).not.toBeChecked();
      expect(f.posts()).toHaveLength(1);
    });

    it.each(['targeted', 'full'] as const)('requires an explicit one-run automatic confirmation for %s checks and exposes revoke', async mode => {
      const f = liveFixture();
      render(<FixerrorsControlPanel />);
      await openDetails('Activity');
      const permission = screen.getByRole('checkbox', { name: 'Allow pre-approved automatic deployment after tests pass' });
      expect(permission).not.toBeChecked();
      expect(screen.getByRole('checkbox', { name: 'Run full checks (fap)' })).not.toBeChecked();
      if (mode === 'full') fireEvent.click(screen.getByRole('checkbox', { name: 'Run full checks (fap)' }));
      fireEvent.click(permission);
      expect(f.posts()).toEqual([]);
      expect(screen.getByRole('alert').textContent).toMatch(/without another click.*4 hours.*only to this run and runner/);
      fireEvent.click(screen.getByRole('button', { name: 'Confirm automatic Deploy and start this run' }));
      await waitFor(() => expect(f.store.state.jobs).toHaveLength(1));
      expect(f.posts()).toEqual([{ op: 'enqueue', requestId: expect.any(String), deviceId: f.store.state.devices[0].id,
        action: 'repair', requestedReleaseMode: mode, autoDeployConfirmation: true }]);
      await screen.findByText(/One-run automatic Deploy: pending/);
      expect(permission).not.toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Revoke automatic Deploy' }));
      await screen.findByText(/One-run automatic Deploy: revoked/);
      expect(f.store.state.jobs).toHaveLength(1);
      expect(f.posts().at(-1)).toEqual({ op: 'revoke-preapproval', jobId: f.store.state.jobs[0].id });
    });

    it('clears automatic permission on validation change, runner change and close/reopen without submitting', async () => {
      const f = liveFixture();
      f.store.state.devices.push({ ...f.store.state.devices[0], id: 'a6ca86fc-d7bd-4629-868f-a5e0cec75f48', name: 'Second runner' });
      render(<FixerrorsControlPanel />);
      await openDetails('Runner settings');
      const permission = () => screen.getByRole('checkbox', { name: 'Allow pre-approved automatic deployment after tests pass' });
      fireEvent.click(permission());
      fireEvent.click(screen.getByRole('checkbox', { name: 'Run full checks (fap)' }));
      expect(permission()).not.toBeChecked();
      fireEvent.click(permission());
      fireEvent.click(screen.getByRole('radio', { name: 'Use Second runner' }));
      expect(permission()).not.toBeChecked();
      fireEvent.click(permission());
      closeDetails();
      await openDetails('Activity');
      expect(permission()).not.toBeChecked();
      expect(f.posts()).toEqual([]);
    });

    it('clears a failed automatic submission and never retries or restores its permission', async () => {
      const store = new FixtureStore();
      const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => ({
        ok: options?.method !== 'POST', json: async () => ({
          enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
        }),
      }));
      vi.stubGlobal('fetch', fetcher);
      render(<FixerrorsControlPanel />);
      await openDetails('Activity');
      fireEvent.click(screen.getByRole('checkbox', { name: 'Allow pre-approved automatic deployment after tests pass' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm automatic Deploy and start this run' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      expect(screen.getByRole('checkbox', { name: 'Allow pre-approved automatic deployment after tests pass' })).not.toBeChecked();
      fireEvent(window, new Event('online'));
      await waitFor(() => expect(screen.queryByText('Refreshing companion state...')).toBeNull());
      expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(1);
      expect(screen.getByRole('button', { name: 'Start review and repair' })).toBeEnabled();
    });

    it('records one full investigation-and-repair batch, never duplicating review or auto-Deploying', async () => {
      const f = liveFixture();
      await f.start();
      expect(f.posts()).toEqual([{ op: 'enqueue', requestId: expect.any(String), deviceId: f.store.state.devices[0].id, action: 'repair', requestedReleaseMode: 'targeted' }]);
      expect(f.posts()[0]).not.toHaveProperty('reviewJobId');
      fireEvent(window, new Event('focus'));
      fireEvent(window, new Event('online'));
      await waitFor(() => expect(screen.queryByText('Refreshing companion state...')).toBeNull());
      expect(f.posts()).toHaveLength(1);
      const claim = await f.h.claim();
      await f.h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken, result: { status: 'tested', candidate, checks } });
      fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
      await screen.findByText('Deploy-ready: inspect the exact tested candidate and separately confirm Deploy.');
      expect(f.posts()).toHaveLength(1);
      expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull();
      expect(screen.getByRole('button', { name: 'Deploy: review exact candidate' })).toBeDefined();
    });

    it.each(['opt-out', 'drift', 'retained hold', 'blocked run'] as const)('never silently retries after %s', async change => {
      const f = liveFixture();
      await f.start();
      const claim = await f.h.claim();
      await f.h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken,
        result: { status: 'blocked', reason: 'execution-failed' } });
      if (change === 'opt-out') f.store.state.devices[0].allowDeploy = false;
      if (change === 'drift') f.store.state.devices[0].workspace!.tree = 'f'.repeat(40);
      if (change === 'retained hold') f.store.state.devices[0].holdReason = 'packet-needs-reconciliation';
      fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop automatic continuation' })).toBeNull());
      expect(f.posts()).toHaveLength(1);
      f.store.state.devices[0].allowDeploy = true;
      f.store.state.devices[0].holdReason = undefined;
      fireEvent(window, new Event('online'));
      await waitFor(() => expect(screen.queryByText('Refreshing companion state...')).toBeNull());
      expect(f.posts()).toHaveLength(1);
    });

    it('retains lifecycle-pending history without automatically starting another batch', async () => {
      const f = liveFixture();
      await f.start();
      const claim = await f.h.claim();
      await f.h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken, result: { status: 'no-change' } });
      f.store.state.jobs[0].batch = { captured: 1, rows: 1, processed: 1, remaining: 0,
        counts: { 'verified-local': 0, held: 0, 'report-only': 1, failed: 0 }, lifecycle: 'pending' };
      fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
      await screen.findByText(/Lifecycle: pending/);
      expect(f.posts()).toHaveLength(1);
      f.store.state.jobs[0].batch.lifecycle = 'applied';
      fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
      await waitFor(() => expect(screen.queryByText('Refreshing companion state...')).toBeNull());
      expect(f.posts()).toHaveLength(1);
    });

    it('keeps a failed-refresh snapshot visible, invalidates continuation and consent, then recovers without submission', async () => {
      const store = new FixtureStore();
      await harness(store).testedRepair();
      let failed = false;
      const fetcher = vi.fn(async (_url: unknown, _options?: RequestInit) => ({ ok: !failed, json: async () => ({
        enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
      }) }));
      vi.stubGlobal('fetch', fetcher);
      render(<FixerrorsControlPanel />);
      await openDeploy();
      fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying/ }));
      failed = true;
      fireEvent.click(screen.getByRole('button', { name: 'Refresh companion state' }));
      await waitFor(() => expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull());
      await openDetails('Activity');
      expect(screen.getByText(/^Stale snapshot:/)).toBeDefined();
      expect(screen.getByText(store.state.jobs[0].id)).toBeDefined();
      expect((screen.getByRole('button', { name: 'Deploy: review exact candidate' }) as HTMLButtonElement).disabled).toBe(true);
      failed = false;
      fireEvent(window, new Event('online'));
      await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
      expect(screen.getByText(/^Last successful update:/)).toBeDefined();
      expect(fetcher.mock.calls.filter(call => call[1]?.method === 'POST')).toHaveLength(0);
      expect(screen.queryByRole('checkbox', { name: /I approve deploying/ })).toBeNull();
    });

    it('uses one non-overlapping polling loop, accelerates while connecting and aborts on unmount', async () => {
      const store = new FixtureStore();
      store.state.devices[0].lastSeenAt = now - 50_000;
      const timers = vi.spyOn(globalThis, 'setInterval');
      const clears = vi.spyOn(globalThis, 'clearInterval');
      let resolve!: (value: unknown) => void;
      const fetcher = vi.fn().mockImplementation(() => new Promise(done => { resolve = done; }));
      vi.stubGlobal('fetch', fetcher);
      const view = render(<FixerrorsControlPanel />);
      fireEvent(window, new Event('focus'));
      fireEvent(window, new Event('online'));
      fireEvent(document, new Event('visibilitychange'));
      expect(fetcher).toHaveBeenCalledOnce();
      const firstSignal = fetcher.mock.calls[0][1].signal as AbortSignal;
      await act(async () => { resolve({ ok: true, json: async () => ({
        enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
      }) }); });
      const connecting = timers.mock.calls.findIndex(([, delay]) => delay === 3_000);
      expect(connecting).toBeGreaterThanOrEqual(0);
      const callback = timers.mock.calls[connecting][0];
      act(() => { if (typeof callback === 'function') { callback(); callback(); } });
      expect(fetcher).toHaveBeenCalledTimes(2);
      const pendingSignal = fetcher.mock.calls[1][1].signal as AbortSignal;
      view.unmount();
      expect(firstSignal.aborted).toBe(false);
      expect(pendingSignal.aborted).toBe(true);
      expect(clears).toHaveBeenCalledWith(timers.mock.results[connecting].value);
      fireEvent(window, new Event('online'));
      expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it('ignores a pre-mutation refresh arriving after an uncertain POST failure', async () => {
      const store = new FixtureStore();
      await harness(store).testedRepair();
      const body = { enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state) };
      let gets = 0;
      let oldGet!: (value: unknown) => void;
      vi.stubGlobal('fetch', vi.fn((_url: unknown, options?: RequestInit) => {
        if (options?.method === 'POST') return Promise.reject(new Error('network lost'));
        if (++gets === 1) return Promise.resolve({ ok: true, json: async () => body });
        return new Promise(resolve => { oldGet = resolve; });
      }));
      render(<FixerrorsControlPanel />);
      await openDeploy();
      fireEvent.click(screen.getByRole('checkbox', { name: /I approve deploying/ }));
      fireEvent(window, new Event('focus'));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm Deploy for exact candidate' }));
      await waitFor(() => expect(toast.error).toHaveBeenCalled());
      await act(async () => { oldGet({ ok: true, json: async () => body }); });
      await openDetails('Activity');
      expect(screen.getByText(/^Stale snapshot:/)).toBeDefined();
      expect(screen.getByRole('button', { name: 'Deploy: review exact candidate' })).toBeDisabled();
    });

    it('copies bounded correlation and fixed-code diagnostics, not packets, exception text or configuration', async () => {
      const store = new FixtureStore();
      const h = harness(store);
      await h.enqueue();
      const claim = await h.claim();
      await h.device({ op: 'complete', jobId: claim.job.id, leaseToken: claim.leaseToken,
        result: { status: 'failed', reason: 'execution-failed', diagnostic: 'native-import-unavailable' } });
      store.state.jobs[0].packet = 'PRIVATE_PACKET_MUST_NOT_ESCAPE';
      const writeText = vi.fn(async (_text: string) => {});
      vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
      vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({
        enabled: true, executionAvailable: true, origin: FIXERRORS_PRODUCTION_ORIGIN, ...publicQueueState(store.state),
      }) })));
      render(<FixerrorsControlPanel />);
      await openDetails('Activity');
      await screen.findByText(/Native diagnostic: native-import-unavailable/);
      fireEvent.click(screen.getByRole('button', { name: `Copy diagnostics for ${claim.job.id}` }));
      await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
      expect(JSON.parse(writeText.mock.calls[0][0])).toMatchObject({
        jobId: claim.job.id, diagnostic: 'native-import-unavailable', state: 'failed', stale: false,
      });
      expect(writeText.mock.calls[0][0]).not.toMatch(/PRIVATE_PACKET|credential|privateBatch|exception|enrollment/);
      expect(screen.getByText(/No completion ETA is reported/)).toBeDefined();
    });
  });
});
