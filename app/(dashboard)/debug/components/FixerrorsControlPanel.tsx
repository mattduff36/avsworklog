'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { adminResponseSchema, FIXERRORS_PRODUCTION_ORIGIN, sameCandidate, type AdminCommand, type Candidate, type CheckEvidence, type ReleaseMode } from '@/lib/fixerrors/protocol';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PanelLoader } from '@/components/ui/panel-loader';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger, dialogContentViewportClassName } from '@/components/ui/dialog';

type Snapshot = z.infer<typeof adminResponseSchema>;
type Confirmation = { repairJobId: string; candidate: Candidate; release?: CheckEvidence['release'] };
type DetailView = 'activity' | 'history' | 'settings';

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
  const [detailView, setDetailView] = useState<DetailView | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>('full');
  const activityTrigger = useRef<HTMLButtonElement>(null);
  const openingDeploy = useRef(false);
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/debug/fixerrors', { cache: 'no-store' });
      if (!response.ok) throw new Error('Fixerrors controls unavailable or access denied');
      const nextSnapshot = adminResponseSchema.parse(await response.json());
      setSnapshot(nextSnapshot);
      setSelectedDeviceId(current => current ?? nextSnapshot.devices.find(device => !device.revoked)?.id ?? nextSnapshot.devices[0]?.id ?? null);
      setFailure(null);
    } catch {
      setSnapshot(null);
      setFailure('Unable to load Fixerrors controls. Existing error logs are unaffected.');
    }
  }, []);

  useEffect(() => {
    if (!allowed) {
      setDetailView(null);
      setConfirmation(null);
      setConfirmed(false);
      return;
    }
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [allowed, refresh]);

  const currentRepair = confirmation && snapshot?.jobs.find((job) => job.id === confirmation.repairJobId);
  const confirmationValid = Boolean(allowed && snapshot?.enabled && !snapshot.releaseNeedsReconciliation &&
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

  async function submit(command: AdminCommand) {
    setBusy(true);
    try {
      const response = await fetch('/api/debug/fixerrors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command),
      });
      if (!response.ok) {
        const body = z.object({ error: z.string() }).parse(await response.json());
        throw new Error(body.error);
      }
      const result = z.object({ ok: z.literal(true), jobId: z.string().optional(), noWork: z.boolean().optional() }).parse(await response.json());
      toast.success(result.noWork ? 'No active untriaged or outstanding errors; no worker launched'
        : command.op === 'approve-deploy' ? 'Exact-candidate deployment approved for the selected checks' : 'Companion request recorded');
      setConfirmation(null);
      setConfirmed(false);
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Companion request failed');
    } finally {
      setBusy(false);
    }
  }

  function dismissConfirmation() {
    setConfirmation(null);
    setConfirmed(false);
    setReleaseMode('full');
  }

  if (!allowed) return null;
  const device = snapshot?.devices.find(entry => entry.id === selectedDeviceId);
  const status = device && snapshot ? deviceStatus(device, snapshot.jobs) : null;
  const connectionLabel = failure ? 'Unavailable' : !snapshot ? 'Loading...' : !snapshot.enabled ? 'Disabled'
    : !device ? selectedDeviceId ? 'Runner unavailable' : 'No devices' : device.revoked ? 'Revoked' : status?.online ? 'Online' : 'Offline';
  const activeJobs = snapshot?.jobs.filter(job => needsAttention(job, snapshot.jobs)) ?? [];
  const previousJobs = snapshot?.jobs.filter(job => !needsAttention(job, snapshot.jobs)) ?? [];
  const requestsDisabled = busy || !snapshot?.enabled || !status?.ready || status.active || status.pending || status.reconciling;
  const renderJobs = (jobs: Snapshot['jobs']) => (
    <div className="divide-y divide-border">
      {jobs.map((job) => (
        <div key={job.id} className="min-w-0 space-y-3 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2"><span className="font-medium capitalize">{job.action}</span> <Badge variant={job.state === 'failed' || job.state === 'unknown' ? 'destructive' : 'secondary'}>{job.state}</Badge> <time className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('en-GB')}</time></div>
          <p className="break-words text-xs text-muted-foreground">Runner: {snapshot?.devices.find(entry => entry.id === job.deviceId)?.name ?? job.deviceId}</p>
          {job.reason && <p className="break-words text-muted-foreground">{job.reason}</p>}
          {job.batch && <div className="space-y-1 text-xs text-muted-foreground" aria-label="Batch progress" role="status">
            <p>{job.batch.processed} / {job.batch.captured} cases processed; {job.batch.remaining} remaining ({job.batch.rows} error rows captured).</p>
            <p>{job.batch.counts['verified-local']} verified locally / {job.batch.counts.held} held / {job.batch.counts['report-only']} report only / {job.batch.counts.failed} failed.</p>
            <p>Lifecycle: {job.batch.lifecycle}{job.batch.lifecycleReason ? ` (${job.batch.lifecycleReason})` : ''}. {job.batch.lifecycle !== 'applied' ? 'Error records are not confirmed reconciled.' : 'Local verification is not a live fix.'}</p>
          </div>}
          {job.action !== 'deploy' && ['queued', 'leased', 'paused'].includes(job.state) && (
            <Button variant="outline" size="sm" disabled={busy}
              onClick={() => void submit({ op: 'cancel', jobId: job.id })}>Cancel run</Button>
          )}
          {job.approval && <p className="text-xs text-muted-foreground">{(job.approval.releaseMode ?? 'full') === 'targeted' ? 'Targeted checks (urgent)' : 'Full checks (fap)'} / separately confirmed {new Date(job.approval.confirmedAt).toLocaleString('en-GB')}</p>}
          {job.candidate && <CandidateDetails candidate={job.candidate} release={job.checks?.release} />}
          {job.action === 'repair' && job.state === 'tested' && job.candidate && !snapshot?.jobs.some((entry) => entry.parentRepairId === job.id) && (
            <Button variant="outline" size="sm" disabled={busy || snapshot?.releaseNeedsReconciliation || Boolean(job.batch && job.batch.lifecycle !== 'applied')}
              onClick={() => {
                if (job.candidate) {
                  openingDeploy.current = true;
                  setDetailView(null);
                  setConfirmed(false);
                  setReleaseMode('full');
                  setConfirmation({ repairJobId: job.id, candidate: job.candidate, release: job.checks?.release });
                }
              }}>Deploy: review exact candidate</Button>
          )}
        </div>
      ))}
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
        <Button size="sm" variant="outline" className="border-white/30 bg-slate-900 text-slate-100 hover:bg-slate-800 hover:text-white"
          disabled={requestsDisabled || !device?.allowReadOnly}
          onClick={() => { if (device) void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'review' }); }}>Review</Button>
        <Button size="sm" className="bg-slate-900 text-white hover:bg-slate-800"
          disabled={requestsDisabled || !device?.allowRepair || snapshot?.releaseNeedsReconciliation}
          onClick={() => { if (device) void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'repair' }); }}>Run batch</Button>
        <Button size="sm" variant="ghost" className="h-8 w-8 p-0 text-white hover:bg-white/15 hover:text-white" aria-label="Refresh companion state" title="Refresh companion state"
          disabled={busy} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" /></Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {(['activity', 'history', 'settings'] as const).map(view => (
          <Dialog key={view} open={detailView === view} onOpenChange={open => setDetailView(open ? view : null)}>
            <DialogTrigger asChild>
              <Button ref={view === 'activity' ? activityTrigger : undefined} size="sm" variant="ghost"
                className="h-7 px-2 text-xs text-white hover:bg-white/15 hover:text-white">
                {view === 'activity' ? `Activity (${activeJobs.length})` : view === 'history' ? `History (${previousJobs.length})` : 'Runner settings'}
              </Button>
            </DialogTrigger>
            <DialogContent className={dialogContentViewportClassName({
              size: view === 'settings' ? '4xl' : '6xl',
              className: 'sm:w-[calc(100vw-6rem)]',
            })}
              onCloseAutoFocus={event => { if (openingDeploy.current) event.preventDefault(); }}>
              <DialogHeader>
                <DialogTitle>{view === 'activity' ? 'Current Fixerrors activity' : view === 'history' ? 'Previous Fixerrors activity' : 'Fixerrors runner settings'}</DialogTitle>
                <DialogDescription>
                  {view === 'settings' ? 'Run one full batch of new and outstanding errors on the connected Windows companion. Local opt-ins are controlled on each device.'
                    : 'Progress includes held cases; verified local repairs await separate approval of the single tested candidate.'}
                </DialogDescription>
              </DialogHeader>
              {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
              {!snapshot && !failure && <PanelLoader />}
              {snapshot && !snapshot.enabled && (
                <p className="text-sm text-muted-foreground">Disabled by default. Configuration and explicit device provisioning are required.</p>
              )}
              {snapshot?.enabled && view !== 'settings' && (
                view === 'activity'
                  ? activeJobs.length ? renderJobs(activeJobs) : <p className="text-sm text-muted-foreground">No active jobs or deployment decisions.</p>
                  : previousJobs.length ? renderJobs(previousJobs) : <p className="text-sm text-muted-foreground">No previous activity.</p>
              )}
              {snapshot?.enabled && view === 'settings' && <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  {snapshot.origin === FIXERRORS_PRODUCTION_ORIGIN ? 'Production controls.' : 'Local rehearsal controls.'}
                  {' '}{snapshot.executionAvailable ? 'A device has reported bridge availability.' : 'No execution bridge has reported availability.'}
                </p>
                {snapshot.releaseNeedsReconciliation && (
                  <p role="alert" className="text-sm text-destructive">A deployment result is unknown. Verify the remote Git ref and release record before attempting another repair or deployment.</p>
                )}
                {snapshot.devices.length === 0 && <p className="text-sm text-muted-foreground">No enrolled devices.</p>}
                {snapshot.devices.map((entry) => {
                  const { online, ready, active, pending } = deviceStatus(entry, snapshot.jobs);
                  return (
                    <div key={entry.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="break-words">{entry.name}</span> <Badge variant="secondary">{entry.revoked ? 'Revoked' : online ? 'Online' : 'Offline'}</Badge></div>
                        <p className="text-xs text-muted-foreground">Runner: {!online ? 'not connected' : active ? 'busy' : pending ? 'tested candidate awaits separate Deploy' : entry.holdReason ?? (!entry.bridgeAvailable ? 'bridge unavailable' : ready ? 'Connected - waiting' : 'checkout unavailable')}</p>
                        <p className="text-xs text-muted-foreground">Local opt-ins: review {entry.allowReadOnly ? 'on' : 'off'} / repair {entry.allowRepair ? 'on' : 'off'} / deploy {entry.allowDeploy ? 'on' : 'off'}</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <label className="flex items-center gap-2 text-sm">
                          <input type="radio" name="fixerrors-runner" checked={entry.id === device?.id}
                            onChange={() => setSelectedDeviceId(entry.id)} disabled={busy} />
                          Use {entry.name}
                        </label>
                        <Button size="sm" variant="ghost" disabled={busy || entry.revoked}
                          onClick={() => void submit({ op: 'revoke-device', deviceId: entry.id })}>Revoke device</Button>
                      </div>
                    </div>
                  );
                })}
              </div>}
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh companion state</Button>
            </DialogContent>
          </Dialog>
        ))}
      </div>
      {failure && <p role="alert" className="max-w-md text-xs text-white">{failure}</p>}
      {snapshot?.releaseNeedsReconciliation && <p role="alert" className="max-w-md text-xs text-white">Deployment result unknown. Open Runner settings to reconcile before continuing.</p>}
      <Dialog open={Boolean(confirmation && confirmationValid)} onOpenChange={open => { if (!open) dismissConfirmation(); }}>
        <DialogContent className={dialogContentViewportClassName({
          size: '4xl',
          className: 'sm:w-[calc(100vw-6rem)]',
        })}
          onCloseAutoFocus={event => {
            event.preventDefault();
            openingDeploy.current = false;
            activityTrigger.current?.focus();
          }}>
          <DialogHeader>
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
                  <Button type="submit" className="h-auto min-h-9 whitespace-normal bg-avs-yellow text-slate-900 hover:bg-avs-yellow-hover text-center" disabled={busy || snapshot?.releaseNeedsReconciliation || !confirmed}>{busy ? 'Recording approval...' : 'Confirm Deploy for exact candidate'}</Button>
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
