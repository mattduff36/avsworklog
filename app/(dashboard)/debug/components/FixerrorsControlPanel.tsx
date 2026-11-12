'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { adminResponseSchema, FIXERRORS_PRODUCTION_ORIGIN, sameCandidate, type AdminCommand, type Candidate, type CheckEvidence, type ReleaseMode } from '@/lib/fixerrors/protocol';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogScrollArea, DialogTitle, DialogTrigger, dialogContentViewportClassName } from '@/components/ui/dialog';

type Snapshot = z.infer<typeof adminResponseSchema>;
type Confirmation = { repairJobId: string; candidate: Candidate; release?: CheckEvidence['release'] };
type ActivityFilter = 'all' | 'attention' | 'previous';
type RunFlow = { deviceId: string; jobId: string };

const REQUEST_FAILURE = 'Request not confirmed. Refresh and inspect activity before retrying; the server may have recorded it.';
const REASON_HELP: Record<string, string> = {
  'bridge-unavailable': 'The pinned execution bridge is unavailable. The owner must verify its installation and source pins.',
  'local-opt-out': 'Local runtime or protected owner consent is missing. Stop the runner, choose E / D and SET DEPLOY, then restart with runtime D.',
  'checkout-drift': 'The checkout or candidate changed. The owner must reconcile retained evidence before requesting a fresh run.',
  'lease-lost': 'Execution authority was lost. Preserve locks and receipts; confirm the stopped outcome before recovery.',
  timeout: 'An execution deadline elapsed. Inspect the private job receipts; do not remove retained locks.',
  'execution-failed': 'Native execution failed or its result could not be verified. Inspect the job-correlated private receipts; no success is assumed.',
  'release-unconfirmed': 'Deployment is unconfirmed. Verify the remote ref and live deployment identity before continuing.',
};
const DIAGNOSTIC_HELP: Record<NonNullable<Snapshot['jobs'][number]['diagnostic']>, string> = {
  'native-import-unavailable': 'The owner must verify the pinned native runtime and its required installed modules before any retry.',
  'typecheck-cache-not-ready': 'With the runner stopped, the parent must inspect and warm the protected TypeScript cache before fresh signed admission.',
  'batch-initialization-refused': 'Native session initialization was refused. Preserve the retained lock and inspect the private admission, checkout and initialization evidence.',
  'batch-execution-unconfirmed': 'A native execution result was not verified. Preserve locks and correlate the private receipts before recovery.',
};

function timestamp(value: number) {
  return new Date(value).toLocaleString('en-GB');
}

function elapsed(createdAt: number, observedAt: number) {
  return `${Math.max(0, Math.floor((observedAt - createdAt) / 1000))}s`;
}

const ACTIVITY_COLUMNS = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.7fr)_minmax(0,0.9fr)_minmax(0,1.7fr)_minmax(0,1.7fr)]';
const DIALOG_GUTTER_CLASSNAME = '[--fixerrors-dialog-gutter:24px] md:[--fixerrors-dialog-gutter:48px]';
const dialogTop = 'max(var(--fixerrors-dialog-gutter), env(safe-area-inset-top, 0px))';
const dialogBottom = 'max(var(--fixerrors-dialog-gutter), env(safe-area-inset-bottom, 0px))';
const dialogLeft = 'max(var(--fixerrors-dialog-gutter), env(safe-area-inset-left, 0px))';
const dialogRight = 'max(var(--fixerrors-dialog-gutter), env(safe-area-inset-right, 0px))';
// Override DialogContent's inline safe-viewport bounds locally, using unscaled CSS pixels.
const DIALOG_VIEWPORT_STYLE: CSSProperties = {
  top: `calc(${dialogTop} + (100dvh - ${dialogTop} - ${dialogBottom}) / 2)`,
  left: `calc(${dialogLeft} + (100vw - ${dialogLeft} - ${dialogRight}) / 2)`,
  width: `calc(100vw - ${dialogLeft} - ${dialogRight})`,
  maxHeight: `calc(100dvh - ${dialogTop} - ${dialogBottom})`,
};

function deviceStatus(device: Snapshot['devices'][number], jobs: Snapshot['jobs']) {
  const online = !device.revoked && device.lastSeenAt !== null && device.lastSeenAt <= Date.now() && Date.now() - device.lastSeenAt < 45_000;
  const ready = online && device.bridgeAvailable && Boolean(device.checkout ?? device.workspace) && !device.holdReason;
  const active = jobs.some((job) => job.deviceId === device.id && ['queued', 'leased', 'paused'].includes(job.state));
  const pending = jobs.some(job => job.deviceId === device.id && job.state === 'tested' &&
    !jobs.some(release => release.parentRepairId === job.id && release.state === 'deployed'));
  const reconciling = jobs.some(job => job.deviceId === device.id && job.batch &&
    !['queued', 'leased', 'paused'].includes(job.state) && job.lifecycleReconciliationRequired);
  return { online, ready, active, pending, reconciling };
}

function needsAttention(job: Snapshot['jobs'][number], jobs: Snapshot['jobs']) {
  return ['queued', 'leased', 'paused', 'unknown'].includes(job.state) ||
    (job.batch && (job.lifecycleReconciliationRequired ||
      ((job.batch.remaining > 0 || job.batch.counts.held > 0 || job.batch.counts.failed > 0) && !jobs.some(later =>
        later.deviceId === job.deviceId && later.createdAt > job.createdAt && later.batch?.lifecycle === 'applied')))) ||
    (job.state === 'tested' && !jobs.some(release => release.parentRepairId === job.id && release.state === 'deployed'));
}

function CandidateDetails({ candidate, release }: { candidate: Candidate; release?: CheckEvidence['release'] }) {
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Tested commit <span className="font-mono text-foreground">{candidate.head.slice(0, 12)}</span></p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Technical candidate details</summary>
        <p className="mt-2 break-all font-mono leading-relaxed">HEAD {candidate.head}<br />Tree {candidate.tree}<br />Checks SHA-256 {candidate.checksSha256}</p>
        {release && <p className="mt-2 break-all font-mono leading-relaxed">Worker candidate SHA-256 {release.candidateSha256}<br />Prepared evidence SHA-256 {release.testEvidenceSha256}</p>}
      </details>
    </div>
  );
}

export function FixerrorsControlPanel() {
  const { isActualSuperAdmin, isViewingAs } = useAuth();
  const allowed = isActualSuperAdmin && !isViewingAs;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [controlOpen, setControlOpen] = useState(false);
  const [flow, setFlow] = useState<RunFlow | null>(null);
  const [flowNotice, setFlowNotice] = useState<string | null>(null);
  const [observedAt, setObservedAt] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>('full');
  const [fullChecks, setFullChecks] = useState(false);
  const [autoDeploy, setAutoDeploy] = useState(false);
  const activityTrigger = useRef<HTMLButtonElement>(null);
  const openingDeploy = useRef(false);
  const posting = useRef(false);
  const fetching = useRef<Promise<void> | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (fetching.current) return fetching.current;
    const controller = new AbortController();
    requestController.current = controller;
    setRefreshing(true);
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const work = (async () => {
      try {
        const response = await fetch('/api/debug/fixerrors', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        const nextSnapshot = adminResponseSchema.parse(await response.json());
        if (controller.signal.aborted || requestController.current !== controller) return;
        setSnapshot(nextSnapshot);
        setObservedAt(Date.now());
        setSelectedDeviceId(current => current ?? nextSnapshot.devices.find(device => !device.revoked)?.id ?? nextSnapshot.devices[0]?.id ?? null);
        setFailure(null);
      } catch {
        if (requestController.current !== controller) return;
        setFailure('Unable to refresh Fixerrors controls. Last successful snapshot is stale; actions are disabled. Existing error logs are unaffected.');
        setFlow(null);
        setFlowNotice('Live status is unavailable. Recorded work may still be running; inspect activity before requesting another run.');
        setConfirmation(null);
        setConfirmed(false);
        setAutoDeploy(false);
      } finally {
        clearTimeout(timeout);
        if (requestController.current === controller) {
          fetching.current = null;
          setRefreshing(false);
        }
      }
    })();
    fetching.current = work;
    return work;
  }, []);

  useEffect(() => {
    if (!allowed) {
      setControlOpen(false);
      setFlow(null);
      setSnapshot(null);
      setConfirmation(null);
      setConfirmed(false);
      setAutoDeploy(false);
      return;
    }
    const wake = () => { void refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') wake(); };
    void refresh();
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', visible);
    return () => {
      requestController.current?.abort();
      requestController.current = null;
      fetching.current = null;
      window.removeEventListener('focus', wake);
      window.removeEventListener('online', wake);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [allowed, refresh]);

  const fastPolling = Boolean(flow || snapshot?.jobs.some(job => ['queued', 'leased', 'paused'].includes(job.state)) ||
    snapshot?.devices.some(device => deviceStatus(device, snapshot.jobs).online) === false);
  useEffect(() => {
    if (!allowed) return;
    const timer = setInterval(() => { void refresh(); }, fastPolling ? 3_000 : 20_000);
    return () => clearInterval(timer);
  }, [allowed, fastPolling, refresh]);

  const currentRepair = confirmation && snapshot?.jobs.find((job) => job.id === confirmation.repairJobId);
  const confirmationValid = Boolean(allowed && !failure && snapshot?.enabled && !snapshot.releaseNeedsReconciliation &&
    confirmation && currentRepair?.state === 'tested' && currentRepair.candidate &&
    sameCandidate(currentRepair.candidate, confirmation.candidate) &&
    (!currentRepair.batch || currentRepair.batch.lifecycle === 'applied') &&
    !snapshot?.jobs.some((job) => job.parentRepairId === confirmation.repairJobId));
  useEffect(() => {
    if (confirmation && !confirmationValid) {
      setConfirmation(null);
      setConfirmed(false);
    }
  }, [confirmation, confirmationValid]);

  const submit = useCallback(async (command: AdminCommand) => {
    const invalidateRefresh = () => {
      requestController.current?.abort();
      requestController.current = null;
      fetching.current = null;
      setRefreshing(false);
    };
    if (posting.current) return null;
    posting.current = true;
    invalidateRefresh();
    setBusy(true);
    setAutoDeploy(false);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch('/api/debug/fixerrors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(REQUEST_FAILURE);
      }
      const result = z.object({ ok: z.literal(true), jobId: z.string().uuid().optional(), noWork: z.boolean().optional() }).parse(await response.json());
      if (command.op === 'enqueue' && !result.noWork && result.jobId !== command.requestId) throw new Error(REQUEST_FAILURE);
      if (command.op === 'enqueue' && result.noWork) {
        setFlow(null);
        setFlowNotice('No eligible errors; no worker launched.');
      }
      toast.success(result.noWork ? 'No active untriaged or outstanding errors; no worker launched'
        : command.op === 'approve-deploy' ? 'Exact-candidate deployment approved for the selected checks' : 'Companion request recorded');
      setConfirmation(null);
      setConfirmed(false);
      // A GET begun before this mutation cannot establish its accepted state.
      invalidateRefresh();
      await refresh();
      return result;
    } catch {
      invalidateRefresh();
      setFailure(REQUEST_FAILURE);
      setFlow(null);
      setFlowNotice(REQUEST_FAILURE);
      setConfirmed(false);
      toast.error(REQUEST_FAILURE);
      return null;
    } finally {
      clearTimeout(timeout);
      posting.current = false;
      setBusy(false);
    }
  }, [refresh]);

  useEffect(() => {
    if (!flow || !snapshot || failure || busy) return;
    const runner = snapshot.devices.find(entry => entry.id === flow.deviceId);
    if (!runner || runner.revoked || !runner.allowReadOnly || !runner.allowRepair || !runner.allowDeploy) {
      setFlow(null);
      setFlowNotice('The selected runner or D consent is no longer available. Inspect the recorded job before restarting.');
      return;
    }
    const job = snapshot.jobs.find(entry => entry.id === flow.jobId);
    if ((runner.holdReason && !(runner.holdReason === 'prepared-candidate' && job?.state === 'tested')) ||
        snapshot.releaseNeedsReconciliation) {
      setFlow(null);
      setFlowNotice('The runner reported a retained-work or release hold. Preserve evidence for owner reconciliation.');
      return;
    }
    if (!job || ['queued', 'leased', 'paused'].includes(job.state)) return;
    setFlow(null);
    setFlowNotice(job.state === 'tested' ? job.autoDeployment?.state === 'pending'
      ? 'Deploy-ready: conditional automatic Deploy is waiting for all server and runner gates.'
      : job.autoDeployment?.state === 'consumed' ? 'Automatic exact-candidate Deploy recorded. Inspect its release job below.'
      : 'Deploy-ready: inspect the exact tested candidate and separately confirm Deploy.'
      : job.state === 'no-work' ? 'No eligible errors; no worker launched.'
      : `Run stopped at ${job.state}. Inspect its diagnostics and retained attempts below.`);
  }, [flow, snapshot, failure, busy]);

  function dismissConfirmation() {
    setConfirmation(null);
    setConfirmed(false);
    setReleaseMode('full');
  }

  if (!allowed) return null;
  const device = snapshot?.devices.find(entry => entry.id === selectedDeviceId);
  const status = device && snapshot ? deviceStatus(device, snapshot.jobs) : null;
  const connectionLabel = failure ? snapshot ? 'Stale snapshot' : 'Unavailable' : !snapshot ? 'Loading...' : !snapshot.enabled ? 'Disabled'
    : !device ? selectedDeviceId ? 'Runner unavailable' : 'No devices' : device.revoked ? 'Revoked' : status?.online ? 'Online' : 'Offline';
  const newestJobs = [...(snapshot?.jobs ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const activeJobs = newestJobs.filter(job => needsAttention(job, newestJobs));
  const previousJobs = newestJobs.filter(job => !needsAttention(job, newestJobs));
  const visibleJobs = activityFilter === 'attention' ? activeJobs : activityFilter === 'previous' ? previousJobs : [...activeJobs, ...previousJobs];
  const requestsDisabled = busy || Boolean(failure) || Boolean(flow) || !snapshot?.enabled || !status?.ready || status.active || status.pending || status.reconciling || snapshot.releaseNeedsReconciliation;
  const missingDConsent = device && (!device.allowReadOnly || !device.allowRepair || !device.allowDeploy);
  const startDisabled = requestsDisabled || Boolean(missingDConsent);
  const startRun = () => {
    setActivityFilter('all');
    if (startDisabled || !device) return;
    const requestId = crypto.randomUUID();
    setFlowNotice(null);
    setFlow({ deviceId: device.id, jobId: requestId });
    void submit({ op: 'enqueue', requestId, deviceId: device.id, action: 'repair',
      requestedReleaseMode: fullChecks ? 'full' : 'targeted',
      ...(autoDeploy ? { autoDeployConfirmation: true as const } : {}),
    }).then(result => {
      if (!result) setFlow(null);
    });
  };
  const copyDiagnostics = async (job: Snapshot['jobs'][number]) => {
    const diagnostic = {
      jobId: job.id, deviceId: job.deviceId, action: job.action, state: job.state,
      reason: job.reason, diagnostic: job.diagnostic ?? null, createdAt: job.createdAt, expiresAt: job.expiresAt,
      leaseUntil: job.leaseUntil, snapshotAt: observedAt, stale: Boolean(failure), batch: job.batch,
      candidate: job.candidate,
    };
    try { await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2)); toast.success('Job diagnostics copied'); }
    catch { toast.error('Unable to copy diagnostics. Select the visible job ID and diagnostic details instead.'); }
  };
  const renderJobs = (jobs: Snapshot['jobs']) => (
    <div role="table" aria-label="Fixerrors activity runs" className="min-w-0 [overflow-wrap:anywhere]">
      <div role="rowgroup" className="sr-only lg:not-sr-only">
        <div role="row" className={`grid gap-4 border-b border-border pb-2 text-xs font-medium text-muted-foreground ${ACTIVITY_COLUMNS}`}>
          {['Run/date', 'Status', 'Runner', 'Progress/result', 'Actions/details'].map(label => <div key={label} role="columnheader">{label}</div>)}
        </div>
      </div>
      <div role="rowgroup" className="divide-y divide-border">
        {jobs.map((job) => {
          const canCancel = job.action !== 'deploy' && ['queued', 'leased', 'paused'].includes(job.state);
          const canReviewDeploy = job.action === 'repair' && job.state === 'tested' && job.candidate && !snapshot?.jobs.some(entry => entry.parentRepairId === job.id);
          const autoRelease = snapshot?.jobs.find(entry => entry.parentRepairId === job.id);
          const canRevokePreapproval = job.autoDeployment && ['pending', 'consumed'].includes(job.autoDeployment.state) &&
            (!autoRelease || (['queued', 'leased'].includes(autoRelease.state) && !autoRelease.deployStarted));
          return (
            <div key={job.id} role="row" className={`grid min-w-0 grid-cols-1 gap-3 py-4 text-sm lg:gap-4 ${ACTIVITY_COLUMNS}`}>
              <div role="cell" className="min-w-0 space-y-1">
                <span className="block text-xs font-medium text-muted-foreground lg:hidden">Run/date</span>
                <p className="font-medium capitalize">{job.action}</p>
                <time dateTime={new Date(job.createdAt).toISOString()} className="block text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('en-GB')}</time>
                <p className="break-all font-mono text-xs text-muted-foreground">{job.id}</p>
              </div>
              <div role="cell" className="min-w-0 space-y-1">
                <span className="block text-xs font-medium text-muted-foreground lg:hidden">Status</span>
                <Badge variant={job.state === 'failed' || job.state === 'unknown' ? 'destructive' : 'secondary'}>{job.state}</Badge>
              </div>
              <div role="cell" className="min-w-0 space-y-1">
                <span className="block text-xs font-medium text-muted-foreground lg:hidden">Runner</span>
                <p className="text-xs text-muted-foreground">{snapshot?.devices.find(entry => entry.id === job.deviceId)?.name ?? job.deviceId}</p>
              </div>
              <div role="cell" className="min-w-0 space-y-2">
                <span className="block text-xs font-medium text-muted-foreground lg:hidden">Progress/result</span>
                {job.reason && <p className="text-muted-foreground">{job.reason}</p>}
                {job.reason && <p className="text-xs text-muted-foreground">{REASON_HELP[job.reason]}</p>}
                {job.diagnostic && <p className="text-xs text-muted-foreground">Native diagnostic: {job.diagnostic}. {DIAGNOSTIC_HELP[job.diagnostic]} Private receipts remain on the runner; no raw error output is exposed.</p>}
                <p className="text-xs text-muted-foreground">Stage: {job.state === 'leased' ? `${job.action} executing (operation detail not reported)` : job.state}.
                  {['queued', 'leased', 'paused'].includes(job.state) && observedAt !== null && ` Elapsed at snapshot: ${elapsed(job.createdAt, observedAt)}.`}</p>
                <p className="text-xs text-muted-foreground">{job.leaseUntil !== null ? `Lease deadline: ${timestamp(job.leaseUntil)}.` : `Admission / queued deadline: ${timestamp(job.expiresAt)}.`} No completion ETA is reported.</p>
                {job.batch && <div className="space-y-1 text-xs text-muted-foreground" aria-label="Batch progress" role="status">
                  <p>{job.batch.processed} / {job.batch.captured} cases processed; {job.batch.remaining} remaining ({job.batch.rows} error rows captured).</p>
                  <p>{job.batch.counts['verified-local']} verified locally / {job.batch.counts.held} held / {job.batch.counts['report-only']} report only / {job.batch.counts.failed} failed.</p>
                  {job.batch.triage && <p>Importance (processed): {job.batch.triage.Routine} Routine / {job.batch.triage.Important} Important / {job.batch.triage.Urgent} Urgent. Importance does not grant repair or Deploy approval.</p>}
                  {job.batch.latest?.diagnostic && <p role="alert">{job.batch.latest.diagnostic === 'worker-provider-limit'
                    ? 'The worker could not investigate: the AI provider spending limit was reached. Check the API organisation limit before retrying.'
                    : 'The worker did not complete its investigation. Inspect the private execution receipts before retrying.'}</p>}
                  {job.batch.latest && <p>Latest: {job.batch.latest.importance} ({job.batch.latest.reason.replaceAll('-', ' ')}); {job.batch.latest.effort} investigation; {job.batch.latest.route.replaceAll('-', ' ')}.
                    {' '}Measured analysis {job.batch.latest.analysisMs} ms / repair and checks {job.batch.latest.repairAndChecksMs} ms / case total {job.batch.latest.totalMs} ms. Worker time limits apply; these timings are not a completion estimate.</p>}
                  <p>Lifecycle: {job.batch.lifecycle}{job.batch.lifecycleReason ? ` (${job.batch.lifecycleReason})` : ''}. {job.batch.lifecycle !== 'applied' ? 'Error records are not confirmed reconciled.' : 'Local verification is not a live fix.'}</p>
                </div>}
                {job.approval && <p className="text-xs text-muted-foreground">{(job.approval.releaseMode ?? 'full') === 'targeted' ? 'Targeted checks (urgent)' : 'Full checks (fap)'} / {snapshot?.jobs.some(parent => parent.autoDeployment?.deployJobId === job.id) ? 'automatically approved from one-run consent' : 'separately confirmed'} {new Date(job.approval.confirmedAt).toLocaleString('en-GB')}</p>}
                {job.requestedReleaseMode && <p className="text-xs text-muted-foreground">Requested validation: {job.requestedReleaseMode === 'full' ? 'full checks (fap)' : 'focused checks'}.</p>}
                {job.autoDeployment && <p className="text-xs text-muted-foreground">One-run automatic Deploy: {job.autoDeployment.state}; {job.autoDeployment.releaseMode === 'full' ? 'full checks (fap)' : 'focused checks'}. Valid until {timestamp(job.autoDeployment.expiresAt)}. An already-started release cannot be undone here.</p>}
                {!job.reason && !job.batch && !job.approval && <p className="text-xs text-muted-foreground">No additional result recorded.</p>}
              </div>
              <div role="cell" className="min-w-0 space-y-2">
                <span className="block text-xs font-medium text-muted-foreground lg:hidden">Actions/details</span>
                {canCancel && (
                  <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal" disabled={busy || Boolean(failure)}
                    onClick={() => { setFlow(null); setFlowNotice('Automatic continuation cancelled.'); void submit({ op: 'cancel', jobId: job.id }); }}>Cancel run</Button>
                )}
                {canRevokePreapproval && <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal"
                  disabled={busy || Boolean(failure)} onClick={() => void submit({ op: 'revoke-preapproval', jobId: job.id })}>Revoke automatic Deploy</Button>}
                {job.candidate && <CandidateDetails candidate={job.candidate} release={job.checks?.release} />}
                {canReviewDeploy && (
                  <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal text-left" disabled={busy || Boolean(failure) || snapshot?.releaseNeedsReconciliation || Boolean(job.batch && job.batch.lifecycle !== 'applied')}
                    onClick={() => {
                      if (job.candidate) {
                        openingDeploy.current = true;
                        setControlOpen(false);
                        setConfirmed(false);
                        setReleaseMode(job.requestedReleaseMode ?? 'full');
                        setConfirmation({ repairJobId: job.id, candidate: job.candidate, release: job.checks?.release });
                      }
                    }}>Deploy: review exact candidate</Button>
                )}
                <Button variant="ghost" size="sm" className="h-auto whitespace-normal" onClick={() => void copyDiagnostics(job)}>Copy diagnostics for {job.id}</Button>
                {!canCancel && !canReviewDeploy && !job.candidate && <p className="text-xs text-muted-foreground">No actions available.</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
  return (
    <div aria-label="Fixerrors companion" className="min-w-0 space-y-2 xl:shrink-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">Fixerrors</span>
        <Badge variant="secondary" title={device?.name} role="status" className="max-w-40" aria-label={device ? `${device.name}: ${connectionLabel}` : undefined}>
          <span className="truncate">
            {device && snapshot && snapshot.devices.length > 1 && `${device.name}: `}
            {connectionLabel}
          </span>
        </Badge>
        <Dialog open={controlOpen} onOpenChange={open => {
          setControlOpen(open);
          setAutoDeploy(false);
          if (open) setActivityFilter('all');
        }}>
          <DialogTrigger asChild>
            <Button ref={activityTrigger} size="sm" className="bg-slate-900 text-white hover:bg-slate-800">Run Fixerrors</Button>
          </DialogTrigger>
          <DialogContent className={dialogContentViewportClassName({
            size: '6xl', scroll: 'content', className: `min-w-0 gap-4 ${DIALOG_GUTTER_CLASSNAME}`,
          })} style={DIALOG_VIEWPORT_STYLE}
            onCloseAutoFocus={event => { if (openingDeploy.current) event.preventDefault(); }}>
            <DialogHeader className="shrink-0 pr-6 text-left">
              <DialogTitle>Fixerrors control centre</DialogTitle>
              <DialogDescription>Investigate all new and outstanding errors, repair eligible cases, and test one candidate. Manual runs stop at Deploy-ready unless you explicitly pre-approve automatic Deploy for this run.</DialogDescription>
            </DialogHeader>
            {snapshot?.enabled && (
              <div role="group" aria-label="Activity filters" className="flex shrink-0 flex-wrap gap-2">
                {([
                  ['all', 'All', newestJobs.length],
                  ['attention', 'Needs attention', activeJobs.length],
                  ['previous', 'Previous', previousJobs.length],
                ] as const).map(([value, label, count]) => (
                  <Button key={value} size="sm" variant="outline" aria-pressed={activityFilter === value}
                    className={activityFilter === value ? 'border-white/80 bg-white text-slate-900 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
                    onClick={() => setActivityFilter(value)}>{label} ({count})</Button>
                ))}
              </div>
            )}
            <DialogScrollArea aria-label="Activity entries" className="min-w-0 space-y-4">
              {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
              {!snapshot && !failure && <PanelLoader />}
              {snapshot && !snapshot.enabled && <p className="text-sm text-muted-foreground">Disabled by default. Configuration and explicit device provisioning are required.</p>}
              {observedAt !== null && <p className="text-xs text-muted-foreground">{failure ? 'Stale snapshot' : 'Last successful update'}: {timestamp(observedAt)}. Runner contact: {device?.lastSeenAt ? timestamp(device.lastSeenAt) : 'not reported'}.</p>}
              {snapshot?.enabled && <>
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <h3 className="text-sm font-semibold">Run status</h3>
                  {!flow && <p className="text-sm text-muted-foreground">{status?.active ? 'A run is already active; its last reported stage is below.' : status?.ready ? 'Runner connected. Review and repair can start when all consent and retained-work gates are clear.' : 'Waiting for a ready, enrolled runner.'}</p>}
                  {flow && <p role="status" className="text-sm">Batch requested: the runner investigates each case before repair and testing. Only explicit one-run pre-approval permits automatic Deploy.</p>}
                  {flowNotice && <p role="status" className="text-sm">{flowNotice}</p>}
                  {missingDConsent && <p role="alert" className="text-sm text-amber-300">D consent is required; no review-only fallback. On this Windows PC, stop Squires Runner, choose E / D, confirm SET DEPLOY, then start Terminal or Service with runtime D. This only enables the workflow, not Deploy approval.</p>}
                  {!status?.online && <p className="text-sm text-muted-foreground">Start Squires Runner on its enrolled Windows PC. Refresh detects its next authenticated heartbeat automatically.</p>}
                  {status?.online && !device?.bridgeAvailable && <p role="alert" className="text-sm text-amber-300">{REASON_HELP['bridge-unavailable']}</p>}
                  {status?.online && !(device?.checkout ?? device?.workspace) && <p className="text-sm text-muted-foreground">No clean checkout has been reported. Inspect local candidate/packet holds; do not delete their locks or replace evidence.</p>}
                  {device?.holdReason && <p role="alert" className="text-sm text-amber-300">{device.holdReason === 'checks-preparing'
                    ? 'Preparing local checks for this release. The runner will become ready automatically when validation finishes.'
                    : device.holdReason === 'checks-unavailable'
                      ? 'Local checks are not ready. Inspect the runner check cache or validation failure, then restart the runner. No batch has started.'
                      : `Runner hold: ${device.holdReason}. Preserve operational locks and private receipts; the owner must reconcile the retained outcome.`}</p>}
                  {status?.pending && <p className="text-sm text-muted-foreground">A tested candidate awaits Deploy. Inspect its activity row and any one-run pre-approval below; no fresh run can replace it.</p>}
                  {status?.reconciling && <p role="alert" className="text-sm text-amber-300">Exact-row lifecycle reconciliation is required before another run.</p>}
                  {snapshot.releaseNeedsReconciliation && <p role="alert" className="text-sm text-destructive">Deployment result unknown. Verify the remote Git ref and live release identity before another repair or deployment.</p>}
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="h-auto min-h-9 whitespace-normal bg-avs-yellow text-slate-900 hover:bg-[#d1b82f]"
                      disabled={startDisabled} onClick={startRun}>{busy ? 'Recording request...' : autoDeploy ? 'Confirm automatic Deploy and start this run' : 'Start review and repair'}</Button>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={fullChecks} disabled={busy || Boolean(flow)}
                        onChange={event => { setFullChecks(event.target.checked); setAutoDeploy(false); }} />
                      Run full checks (fap)
                    </label>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={autoDeploy} disabled={startDisabled}
                        onChange={event => setAutoDeploy(event.target.checked)} />
                      Allow pre-approved automatic deployment after tests pass
                    </label>
                    <Button size="sm" variant="outline" disabled title="A browser cannot securely inspect the installed Windows named pipe.">Launch local runner (unavailable)</Button>
                  </div>
                  <p className="text-xs text-muted-foreground">Unchecked full checks uses focused deployment validation. Repairs always require their focused checks first. Without automatic Deploy pre-approval, a separate exact-candidate confirmation is required.</p>
                  {autoDeploy && <p role="alert" className="text-sm text-amber-300">Confirming starts one run and authorizes deployment of its future successful tested candidate without another click, using {fullChecks ? 'full checks (fap)' : 'focused checks'}. This conditional permission expires 4 hours after the request is recorded, applies only to this run and runner, and is not permission for future runs. You can revoke it before deployment begins; an already-started release cannot simply be undone.</p>}
                  <p className="text-xs text-muted-foreground">Once recorded, the batch continues on the runner even if you close this page. All eligible errors are captured together; investigation and repair run sequentially. Use Cancel run below to stop an active job.</p>
                </div>
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Runner settings</summary>
                  <div className="mt-3 space-y-3">
                    <p className="text-sm text-muted-foreground">{snapshot.origin === FIXERRORS_PRODUCTION_ORIGIN ? 'Production controls.' : 'Local rehearsal controls.'} {snapshot.executionAvailable ? 'A device has reported bridge availability.' : 'No execution bridge has reported availability.'}</p>
                    {snapshot.devices.length === 0 && <p className="text-sm text-muted-foreground">No enrolled devices.</p>}
                    {snapshot.devices.map(entry => {
                      const { online, ready, active, pending } = deviceStatus(entry, snapshot.jobs);
                      return <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                        <div className="min-w-0 space-y-2">
                          <div className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="[overflow-wrap:anywhere]">{entry.name}</span><Badge variant="secondary">{entry.revoked ? 'Revoked' : online ? 'Online' : 'Offline'}</Badge></div>
                          <p className="text-xs text-muted-foreground">Runner: {!online ? 'not connected' : active ? 'busy' : pending ? 'tested candidate awaits Deploy gates or confirmation' : entry.holdReason ?? (!entry.bridgeAvailable ? 'bridge unavailable' : ready ? 'Connected - waiting' : 'checkout unavailable')}</p>
                          <p className="text-xs text-muted-foreground">Local opt-ins: review {entry.allowReadOnly ? 'on' : 'off'} / repair {entry.allowRepair ? 'on' : 'off'} / deploy {entry.allowDeploy ? 'on' : 'off'}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <label className="flex min-w-0 items-center gap-2 text-sm [overflow-wrap:anywhere]">
                            <input type="radio" name="fixerrors-runner" checked={entry.id === device?.id}
                              onChange={() => { setFlow(null); setAutoDeploy(false); setSelectedDeviceId(entry.id); }} disabled={busy || Boolean(flow) || Boolean(failure)} />
                            <span className="min-w-0">Use {entry.name}</span>
                          </label>
                          <Button size="sm" variant="ghost" disabled={busy || Boolean(failure) || entry.revoked}
                            onClick={() => { setFlow(null); void submit({ op: 'revoke-device', deviceId: entry.id }); }}>Revoke device</Button>
                        </div>
                      </div>;
                    })}
                  </div>
                </details>
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold">Activity and history ({newestJobs.length})</h3>
                  {visibleJobs.length ? renderJobs(visibleJobs) : <p className="text-sm text-muted-foreground">{activityFilter === 'attention' ? 'No jobs need attention or deployment decisions.' : activityFilter === 'previous' ? 'No previous activity.' : 'No activity recorded.'}</p>}
                </div>
              </>}
            </DialogScrollArea>
            <Button size="sm" variant="outline" className="shrink-0" disabled={busy || refreshing} onClick={() => void refresh()}>{refreshing ? 'Refreshing companion state...' : 'Refresh companion state'}</Button>
          </DialogContent>
        </Dialog>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-white hover:bg-white/15 hover:text-white" aria-label="Refresh companion state" title="Refresh companion state"
          disabled={busy || refreshing} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      {failure && !controlOpen && <p role="alert" className="max-w-md text-xs text-white">{failure}</p>}
      {snapshot?.releaseNeedsReconciliation && !controlOpen && <p role="alert" className="max-w-md text-xs text-white">Deployment result unknown. Open Run Fixerrors to inspect the retained outcome.</p>}
      <Dialog open={Boolean(confirmation && confirmationValid)} onOpenChange={open => { if (!open) dismissConfirmation(); }}>
        <DialogContent className={dialogContentViewportClassName({
          size: '4xl',
          className: `min-w-0 overflow-x-hidden ${DIALOG_GUTTER_CLASSNAME}`,
        })}
          style={DIALOG_VIEWPORT_STYLE}
          onCloseAutoFocus={event => {
            event.preventDefault();
            openingDeploy.current = false;
            activityTrigger.current?.focus();
          }}>
          <DialogHeader className="pr-6 text-left">
            <DialogTitle>Separate Deploy confirmation</DialogTitle>
            <DialogDescription>Approve only this tested candidate. Any commit, tree or check-evidence change invalidates approval. An enabled runner may deploy after this separate confirmation.</DialogDescription>
          </DialogHeader>
          {confirmation && confirmationValid && (
              <form className="space-y-3" onSubmit={(event) => {
                event.preventDefault();
                if (confirmed && confirmationValid && !busy && !snapshot?.releaseNeedsReconciliation) void submit({
                  op: 'approve-deploy', requestId: crypto.randomUUID(),
                  repairJobId: confirmation.repairJobId, candidate: confirmation.candidate,
                  confirmation: true, releaseMode,
                });
              }}>
                <CandidateDetails candidate={confirmation.candidate} release={confirmation.release} />
                <fieldset className="space-y-3" disabled={busy}>
                  <legend className="mb-2 text-sm font-medium">Release checks</legend>
                  {(['full', 'targeted'] as const).map((mode) => (
                    <label key={mode} className="flex cursor-pointer items-start gap-3 text-sm">
                      <input type="radio" name="fixerrors-release-mode" value={mode} checked={releaseMode === mode}
                        onChange={() => { setReleaseMode(mode); setConfirmed(false); }} className="mt-1 accent-primary" />
                      <span>{mode === 'full' ? 'Full checks (fap)' : 'Targeted checks (urgent)'}<span className="mt-1 block text-xs text-muted-foreground">{mode === 'full' ? 'Recommended. Runs the existing full finalise-and-push gates.' : 'Reuses verified candidate-bound tests, typecheck and lint. No local build or full fap; sensitive and release-infrastructure changes are blocked.'}</span></span>
                    </label>
                  ))}
                </fieldset>
                <p className="text-xs text-muted-foreground">Vercel always builds the pushed candidate, in both modes. Live deployment identity must match before success is reported.</p>
                <label htmlFor="fixerrors-deploy-consent" className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3 text-sm">
                  <Checkbox id="fixerrors-deploy-consent" checked={confirmed} onCheckedChange={(checked) => setConfirmed(checked === true)} disabled={busy} className="mt-0.5" />
                  <span>I approve deploying this exact tested candidate using {releaseMode === 'full' ? 'Full checks (fap)' : 'Targeted checks (urgent)'}.</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" className="h-auto min-h-9 whitespace-normal bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] text-center" disabled={busy || snapshot?.releaseNeedsReconciliation || !confirmed}>{busy ? 'Recording approval...' : 'Confirm Deploy for exact candidate'}</Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={dismissConfirmation}>Cancel</Button>
                  <Button type="button" variant="ghost" disabled={busy} onClick={() => void refresh()}>Refresh companion state</Button>
                </div>
              </form>
            )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
