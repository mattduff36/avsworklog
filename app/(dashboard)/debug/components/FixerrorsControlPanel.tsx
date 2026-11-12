'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { adminResponseSchema, FIXERRORS_PRODUCTION_ORIGIN, sameCandidate, type AdminCommand, type Candidate, type CheckEvidence, type ReleaseMode } from '@/lib/fixerrors/protocol';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { FixerrorsDeploymentProgress } from './FixerrorsDeploymentProgress';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogScrollArea, DialogTitle, DialogTrigger, dialogContentViewportClassName } from '@/components/ui/dialog';

type Snapshot = z.infer<typeof adminResponseSchema>;
type Job = Snapshot['jobs'][number];
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

const JOB_STATUS: Record<Job['state'], { label: string; tone: string; step: string }> = {
  queued: { label: 'Queued', tone: 'border-yellow-400/40 bg-yellow-400/15 text-yellow-200', step: 'Waiting for the runner to claim this run.' },
  leased: { label: 'Running\u2026', tone: 'border-yellow-400/40 bg-yellow-400/15 text-yellow-200', step: 'Executing on the runner. Operation detail is not reported.' },
  paused: { label: 'Paused', tone: 'border-amber-400/40 bg-amber-400/15 text-amber-200', step: 'Paused. Inspect retained evidence before continuing.' },
  reviewed: { label: 'Reviewed', tone: 'border-blue-400/40 bg-blue-400/15 text-blue-200', step: 'Review completed.' },
  tested: { label: 'Tested', tone: 'border-blue-400/40 bg-blue-400/15 text-blue-200', step: 'Candidate tested. Deployment is not yet confirmed.' },
  blocked: { label: 'Blocked', tone: 'border-amber-400/40 bg-amber-400/15 text-amber-200', step: 'Blocked. Resolve the reported hold before retrying.' },
  failed: { label: 'Failed', tone: 'border-red-400/40 bg-red-400/15 text-red-200', step: 'Run failed. No successful outcome is assumed.' },
  expired: { label: 'Expired', tone: 'border-amber-400/40 bg-amber-400/15 text-amber-200', step: 'The run expired. Inspect its retained outcome.' },
  deployed: { label: 'Deployed', tone: 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200', step: 'Live deployment confirmed.' },
  unknown: { label: 'Unknown', tone: 'border-red-400/40 bg-red-400/15 text-red-200', step: 'Outcome unknown. Reconcile the retained evidence before continuing.' },
  'no-work': { label: 'No work', tone: 'border-slate-600 bg-slate-800 text-slate-300', step: 'No eligible errors; no worker launched.' },
  'no-change': { label: 'No change', tone: 'border-slate-600 bg-slate-800 text-slate-300', step: 'Run finished without a candidate change.' },
};
const PRIMARY_ACTION_CLASSNAME = 'bg-avs-yellow text-slate-900 hover:bg-[#d1b82f] focus-visible:ring-2 focus-visible:ring-[#F1D64A] focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900';
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
    (job.batch && (job.lifecycleReconciliationRequired || (job.batch.live && job.batch.live.state !== 'applied') ||
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
  const connectionTone = failure || device?.revoked ? 'border-red-400/40 bg-red-400/15 text-red-200'
    : status?.online && !device?.holdReason ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-200'
    : 'border-amber-400/40 bg-amber-400/15 text-amber-200';
  const newestJobs = [...(snapshot?.jobs ?? [])].sort((a, b) => b.createdAt - a.createdAt);
  const [latestJob, ...historyJobs] = newestJobs;
  const activeJobs = historyJobs.filter(job => needsAttention(job, newestJobs));
  const previousJobs = historyJobs.filter(job => !needsAttention(job, newestJobs));
  const visibleJobs = activityFilter === 'attention' ? activeJobs : activityFilter === 'previous' ? previousJobs : historyJobs;
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
  const renderJob = (job: Job, latest = false) => {
    const canCancel = job.action !== 'deploy' && ['queued', 'leased', 'paused'].includes(job.state);
    const canReviewDeploy = job.action === 'repair' && job.state === 'tested' && job.candidate && !snapshot?.jobs.some(entry => entry.parentRepairId === job.id);
    const autoRelease = snapshot?.jobs.find(entry => entry.parentRepairId === job.id);
    const deploymentParent = job.action === 'deploy'
      ? snapshot?.jobs.find(entry => entry.id === job.parentRepairId && entry.autoDeployment?.deployJobId === job.id)
      : job;
    const showDeploymentProgress = deploymentParent?.autoDeployment && deploymentParent.batch &&
      deploymentParent.batch.remaining === 0 && deploymentParent.batch.processed === deploymentParent.batch.captured &&
      deploymentParent.batch.counts['verified-local'] > 0 && deploymentParent.batch.counts.failed === 0;
    const canRevokePreapproval = job.autoDeployment && ['pending', 'consumed'].includes(job.autoDeployment.state) &&
      (!autoRelease || (['queued', 'leased'].includes(autoRelease.state) && !autoRelease.deployStarted));
    const active = ['queued', 'leased'].includes(job.state);
    const presentation = JOB_STATUS[job.state];
    return (
      <Card key={job.id} role="article" aria-label={latest ? 'Latest run' : `${job.action} run ${job.id}`}
        data-job-state={job.state}
        className={`min-w-0 space-y-4 border-border p-4 text-sm [overflow-wrap:anywhere] ${active ? 'border-yellow-400/30 bg-[rgba(241,214,74,0.06)]' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            {latest ? <h3 className="font-semibold">Latest run</h3> : <h4 className="font-semibold capitalize">{job.action} run</h4>}
            <p className="text-xs text-muted-foreground"><span className="capitalize">{job.action}</span> / <time dateTime={new Date(job.createdAt).toISOString()}>{timestamp(job.createdAt)}</time></p>
          </div>
          <Badge variant="outline" className={`gap-1.5 ${presentation.tone}`}>
            {job.state === 'leased' && <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />}
            {presentation.label}
          </Badge>
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Current step</h4>
            <p>{job.state === 'tested' && autoRelease?.state === 'deployed' ? 'Candidate tested; deployment completed.' : presentation.step}</p>
            <p className="text-xs text-muted-foreground">{snapshot?.devices.find(entry => entry.id === job.deviceId)?.name ?? 'Runner unavailable'}</p>
          </div>
          <div className="min-w-0 space-y-2" aria-label="Batch progress" role="status">
            <h4 className="text-xs font-medium text-muted-foreground">Progress</h4>
            {job.batch ? <>
              <p>{job.batch.processed} / {job.batch.captured} cases processed; {job.batch.remaining} remaining ({job.batch.rows} error rows captured).</p>
              <p className="text-xs text-muted-foreground">{job.batch.counts['verified-local']} verified locally / {job.batch.counts.held} held / {job.batch.counts['report-only']} report only / {job.batch.counts.failed} failed.</p>
            </> : <p className="text-xs text-muted-foreground">{active ? 'Waiting for reported progress.' : 'No case progress reported.'}</p>}
          </div>
          <div className="min-w-0 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">Results</h4>
            {job.reason && <p className={['failed', 'unknown'].includes(job.state) ? 'text-red-200' : 'text-amber-200'}>{REASON_HELP[job.reason]}</p>}
            {job.batch?.latest?.diagnostic && <p role="alert">{job.batch.latest.diagnostic === 'worker-provider-limit'
              ? 'The worker could not investigate: the AI provider spending limit was reached. Check the API organisation limit before retrying.'
              : 'The worker did not complete its investigation. Inspect the private execution receipts before retrying.'}</p>}
            {canReviewDeploy && <p className="text-blue-200">Deploy-ready: {job.autoDeployment?.state === 'pending'
              ? 'conditional automatic Deploy awaits all gates. You can revoke it before deployment begins.'
              : job.batch && job.batch.lifecycle !== 'applied' ? 'lifecycle reconciliation is required before Deploy.'
              : 'review the exact tested candidate and confirm Deploy separately.'}</p>}
            {job.autoDeployment && <p className="text-xs text-muted-foreground">One-run automatic Deploy: {job.autoDeployment.state}; {job.autoDeployment.releaseMode === 'full' ? 'full checks (fap)' : 'focused checks'}.</p>}
            {job.batch && <p className="text-xs text-muted-foreground">Lifecycle: {job.batch.lifecycle}{job.batch.lifecycleReason ? ` (${job.batch.lifecycleReason})` : ''}. {job.batch.lifecycle !== 'applied' ? 'Error records are not confirmed reconciled.' : 'Local verification is not a live fix.'}</p>}
            {job.batch?.live && <p className="text-xs text-muted-foreground">Live verification: {job.batch.live.state}{job.batch.live.reason ? ` (${job.batch.live.reason})` : ''}. {job.batch.live.verifiedRows} exact error rows fixed live; {job.batch.live.remainingRows} locally repaired rows still require original-error verification.</p>}
            {!job.reason && !job.batch && !canReviewDeploy && <p className="text-xs text-muted-foreground">{job.state === 'deployed' ? 'Deployment verified.' : 'No additional result recorded.'}</p>}
          </div>
        </div>
        {job.batch && job.batch.captured > 0 && <Progress
          className="h-2" indicatorClassName="bg-avs-yellow"
          aria-label="Errors reviewed" aria-valuenow={job.batch.processed} aria-valuemin={0} aria-valuemax={job.batch.captured}
          value={Math.min(100, job.batch.processed / job.batch.captured * 100)} />}
        {showDeploymentProgress && deploymentParent?.autoDeployment && <FixerrorsDeploymentProgress
          key={deploymentParent.id} mode={deploymentParent.autoDeployment.releaseMode}
          release={job.action === 'deploy' ? job : autoRelease}
          permission={['queued', 'leased', 'tested'].includes(deploymentParent.state) ? deploymentParent.autoDeployment.state : 'stopped'} stale={Boolean(failure)} />}
        <div className="flex flex-wrap gap-2">
          {canCancel && (
            <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal" disabled={busy || Boolean(failure)}
              onClick={() => { setFlow(null); setFlowNotice('Automatic continuation cancelled.'); void submit({ op: 'cancel', jobId: job.id }); }}>Cancel run</Button>
          )}
          {canRevokePreapproval && <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal"
            disabled={busy || Boolean(failure)} onClick={() => void submit({ op: 'revoke-preapproval', jobId: job.id })}>Revoke automatic Deploy</Button>}
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
        </div>
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Run details and diagnostics</summary>
          <div className="mt-3 space-y-2">
            <p className="break-all font-mono">Job {job.id}<br />Runner {job.deviceId}</p>
            <p>Stage: {job.state === 'leased' ? `${job.action} executing (operation detail not reported)` : job.state}.
              {['queued', 'leased', 'paused'].includes(job.state) && observedAt !== null && ` Elapsed at snapshot: ${elapsed(job.createdAt, observedAt)}.`}</p>
            <p>{job.leaseUntil !== null ? `Lease deadline: ${timestamp(job.leaseUntil)}.` : `Admission / queued deadline: ${timestamp(job.expiresAt)}.`} No completion ETA is reported.</p>
            {job.reason && <p>{job.reason}</p>}
            {job.diagnostic && <p>Native diagnostic: {job.diagnostic}. {DIAGNOSTIC_HELP[job.diagnostic]} Private receipts remain on the runner; no raw error output is exposed.</p>}
            {job.batch?.triage && <p>Importance (processed): {job.batch.triage.Routine} Routine / {job.batch.triage.Important} Important / {job.batch.triage.Urgent} Urgent. Importance does not grant repair or Deploy approval.</p>}
            {job.batch?.latest && <p>Latest: {job.batch.latest.importance} ({job.batch.latest.reason.replaceAll('-', ' ')}); {job.batch.latest.effort} investigation; {job.batch.latest.route.replaceAll('-', ' ')}.
              {' '}Measured analysis {job.batch.latest.analysisMs} ms / repair and checks {job.batch.latest.repairAndChecksMs} ms / case total {job.batch.latest.totalMs} ms. Worker time limits apply; these timings are not a completion estimate.</p>}
            {job.approval && <p className="text-xs text-muted-foreground">{(job.approval.releaseMode ?? 'full') === 'targeted' ? 'Targeted checks (urgent)' : 'Full checks (fap)'} / {snapshot?.jobs.some(parent => parent.autoDeployment?.deployJobId === job.id) ? 'automatically approved from one-run consent' : 'separately confirmed'} {new Date(job.approval.confirmedAt).toLocaleString('en-GB')}</p>}
            {job.requestedReleaseMode && <p className="text-xs text-muted-foreground">Requested validation: {job.requestedReleaseMode === 'full' ? 'full checks (fap)' : 'focused checks'}.</p>}
            {job.autoDeployment && <p>Permission valid until {timestamp(job.autoDeployment.expiresAt)}. An already-started release cannot be undone here.</p>}
            {job.candidate && <CandidateDetails candidate={job.candidate} release={job.checks?.release} />}
            <Button variant="ghost" size="sm" className="h-auto whitespace-normal" aria-label={`Copy diagnostics for ${job.id}`} onClick={() => void copyDiagnostics(job)}>Copy diagnostics</Button>
            {!canCancel && !canReviewDeploy && !job.candidate && <p className="text-xs text-muted-foreground">No actions available.</p>}
          </div>
        </details>
      </Card>
    );
  };
  return (
    <div aria-label="Fixerrors companion" className="min-w-0 space-y-2 xl:shrink-0">
      <div className="flex min-w-0 flex-col items-start gap-2">
        <Dialog open={controlOpen} onOpenChange={open => {
          setControlOpen(open);
          setAutoDeploy(false);
          if (open) setActivityFilter('all');
        }}>
          <DialogTrigger asChild>
            <Button ref={activityTrigger} className={PRIMARY_ACTION_CLASSNAME}>Open FixErrors Control</Button>
          </DialogTrigger>
          <DialogContent className={dialogContentViewportClassName({
            size: '6xl', scroll: 'content', className: `min-w-0 gap-4 ${DIALOG_GUTTER_CLASSNAME}`,
          })} style={DIALOG_VIEWPORT_STYLE}
            onCloseAutoFocus={event => { if (openingDeploy.current) event.preventDefault(); }}>
            <DialogHeader className="shrink-0 pr-6 text-left">
              <DialogTitle>Fixerrors control centre</DialogTitle>
              <DialogDescription>Review errors, repair eligible cases and test a candidate. Deploy requires explicit approval.</DialogDescription>
              {!snapshot?.enabled && <Button size="sm" variant="ghost" className="ml-auto h-8 w-8 p-0" aria-label="Refresh companion state"
                title="Refresh companion state" aria-busy={refreshing} disabled={busy || refreshing} onClick={() => void refresh()}>
                <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
              </Button>}
            </DialogHeader>
            <DialogScrollArea aria-label="Activity entries" className="min-w-0 space-y-4">
              {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
              {!snapshot && !failure && <PanelLoader />}
              {snapshot && !snapshot.enabled && <p className="text-sm text-muted-foreground">Disabled by default. Configuration and explicit device provisioning are required.</p>}
              {failure && observedAt !== null && <p className="text-xs text-muted-foreground">Stale snapshot: {timestamp(observedAt)}.</p>}
              {snapshot?.enabled && <>
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">Run status</h3>
                      {device?.holdReason === 'checks-preparing' && <span role="status" className="flex items-center gap-2 text-xs text-yellow-200">
                        <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin motion-reduce:animate-none" />Checking readiness…
                      </span>}
                      <Badge variant="outline" className={connectionTone}>{connectionLabel}</Badge>
                    </div>
                    <div className="flex flex-col items-end gap-1" aria-label="Run actions">
                    <Button size="sm" className={`h-auto min-h-9 whitespace-normal ${PRIMARY_ACTION_CLASSNAME}`}
                      aria-label={busy ? 'Recording request...' : autoDeploy ? 'Confirm automatic Deploy and start this run' : 'Start review and repair'}
                      aria-busy={busy} disabled={startDisabled} onClick={startRun}>
                      {busy && <Loader2 aria-hidden="true" className="animate-spin" />}
                      {busy ? 'Recording request...' : autoDeploy ? 'Confirm automatic Deploy and start this run' : 'Run Fixerrors'}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Refresh companion state"
                      title="Refresh companion state" aria-busy={refreshing} disabled={busy || refreshing} onClick={() => void refresh()}>
                      <RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
                    </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                    <label htmlFor="fixerrors-full-checks" className="flex cursor-pointer items-center gap-2 text-sm">
                      <Switch id="fixerrors-full-checks" aria-label="Run full checks (fap)" checked={fullChecks} disabled={busy || Boolean(flow)}
                        onCheckedChange={checked => { setFullChecks(checked); setAutoDeploy(false); }} />
                      Full checks (fap)
                    </label>
                    <label htmlFor="fixerrors-auto-deploy" className="flex cursor-pointer items-center gap-2 text-sm">
                      <Switch id="fixerrors-auto-deploy" aria-label="Allow pre-approved automatic deployment after tests pass" checked={autoDeploy}
                        disabled={startDisabled} onCheckedChange={setAutoDeploy} />
                      Auto-deploy after tests
                    </label>
                  </div>
                  {autoDeploy && <p role="alert" className="text-sm text-amber-300">Confirming starts one run and authorizes deployment of its future successful tested candidate without another click, using {fullChecks ? 'full checks (fap)' : 'focused checks'}. This conditional permission expires 4 hours after the request is recorded, applies only to this run and runner, and is not permission for future runs. You can revoke it before deployment begins; an already-started release cannot simply be undone.</p>}
                  {flow && <p role="status" className="text-sm text-muted-foreground">Run requested; waiting for the runner&apos;s next update.</p>}
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
                  {status?.pending && <p className="text-sm text-blue-200">A tested candidate awaits Deploy. Inspect its run and any one-run pre-approval below; no fresh run can replace it.</p>}
                  {status?.reconciling && <p role="alert" className="text-sm text-amber-300">Exact-row lifecycle reconciliation is required before another run.</p>}
                  {snapshot.releaseNeedsReconciliation && <p role="alert" className="text-sm text-destructive">Deployment result unknown. Verify the remote Git ref and live release identity before another repair or deployment.</p>}
                </div>
                {latestJob ? renderJob(latestJob, true) : <p className="text-sm text-muted-foreground">No activity recorded.</p>}
                <details className="min-w-0 rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Previous activity ({historyJobs.length})</summary>
                  <div className="mt-3 space-y-3">
                    <div role="group" aria-label="Activity filters" className="flex flex-wrap gap-2">
                      {([
                        ['all', 'All', historyJobs.length],
                        ['attention', 'Needs attention', activeJobs.length],
                        ['previous', 'Previous', previousJobs.length],
                      ] as const).map(([value, label, count]) => (
                        <Button key={value} size="sm" variant="outline" aria-pressed={activityFilter === value}
                          className={activityFilter === value ? 'border-white/80 bg-white text-slate-900 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
                          onClick={() => setActivityFilter(value)}>{label} ({count})</Button>
                      ))}
                    </div>
                    <div role="region" aria-label="Previous activity runs" className="space-y-3">
                      {visibleJobs.length ? visibleJobs.map(job => renderJob(job)) : <p className="text-sm text-muted-foreground">{activityFilter === 'attention' ? 'No jobs need attention or deployment decisions.' : 'No previous activity.'}</p>}
                    </div>
                  </div>
                </details>
                <details className="rounded-lg border border-border p-3">
                  <summary className="cursor-pointer text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Runner settings</summary>
                  <div className="mt-3 space-y-3">
                    {observedAt !== null && <p className="text-xs text-muted-foreground">Last successful update: {timestamp(observedAt)}. Runner contact: {device?.lastSeenAt ? timestamp(device.lastSeenAt) : 'not reported'}.</p>}
                    <p className="text-xs text-muted-foreground">Unchecked full checks uses focused deployment validation. Repairs always require their focused checks first. Without automatic Deploy pre-approval, a separate exact-candidate confirmation is required.</p>
                    <p className="text-xs text-muted-foreground">Once recorded, the batch continues on the runner even if you close this page. All eligible errors are captured together; investigation and repair run sequentially. Use Cancel run to stop an active job.</p>
                    <Button size="sm" variant="outline" disabled title="A browser cannot securely inspect the installed Windows named pipe.">Launch local runner (unavailable)</Button>
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
              </>}
            </DialogScrollArea>
          </DialogContent>
        </Dialog>
        <div className="flex max-w-full items-center gap-1 rounded-md bg-white/85 px-2 text-slate-900">
          <Badge variant="outline" title={device?.name} role="status" className="max-w-48 border-transparent px-0 text-slate-900" aria-label={device ? `${device.name}: ${connectionLabel}` : undefined}>
            <span className="truncate">
              {device && snapshot && snapshot.devices.length > 1 && `${device.name}: `}
              {connectionLabel}
            </span>
          </Badge>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-slate-900 hover:bg-slate-900/10 hover:text-slate-900" aria-label="Refresh companion state" title="Refresh companion state"
            disabled={busy || refreshing} onClick={() => void refresh()}><RefreshCw className="h-3 w-3" /></Button>
        </div>
      </div>
      {failure && !controlOpen && <p role="alert" className="max-w-md text-xs text-white">{failure}</p>}
      {snapshot?.releaseNeedsReconciliation && !controlOpen && <p role="alert" className="max-w-md text-xs text-white">Deployment result unknown. Open FixErrors Control to inspect the retained outcome.</p>}
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
