'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { adminResponseSchema, FIXERRORS_PRODUCTION_ORIGIN, sameCandidate, type AdminCommand, type Candidate, type CheckEvidence, type ReleaseMode } from '@/lib/fixerrors/protocol';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { PanelLoader } from '@/components/ui/panel-loader';

type Snapshot = z.infer<typeof adminResponseSchema>;
type Confirmation = { repairJobId: string; candidate: Candidate; release?: CheckEvidence['release'] };

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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [releaseMode, setReleaseMode] = useState<ReleaseMode>('full');
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/debug/fixerrors', { cache: 'no-store' });
      if (!response.ok) throw new Error('Fixerrors controls unavailable or access denied');
      setSnapshot(adminResponseSchema.parse(await response.json()));
      setFailure(null);
    } catch {
      setSnapshot(null);
      setFailure('Unable to load Fixerrors controls. Existing error logs are unaffected.');
    }
  }, []);

  useEffect(() => {
    if (!allowed) {
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

  if (!allowed) return null;
  return (
    <Card className="border-border">
      <CardHeader className="gap-2 p-4">
        <CardTitle className="text-lg">Fixerrors companion</CardTitle>
        <CardDescription>
          Run one full batch of new and outstanding errors on the connected Windows companion. Progress includes held cases; verified local repairs await separate approval of the single tested candidate.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
        {!snapshot && !failure && <PanelLoader />}
        {snapshot && !snapshot.enabled && (
          <p className="text-sm text-muted-foreground">Disabled by default. Configuration and explicit device provisioning are required.</p>
        )}
        {snapshot?.enabled && (
          <>
            <p className="text-sm text-muted-foreground">
              {snapshot.origin === FIXERRORS_PRODUCTION_ORIGIN ? 'Production controls.' : 'Local rehearsal controls.'}
              {' '}{snapshot.executionAvailable ? 'A device has reported bridge availability.' : 'No execution bridge has reported availability.'}
            </p>
            {snapshot.releaseNeedsReconciliation && (
              <p role="alert" className="text-sm text-destructive">A deployment result is unknown. Verify the remote Git ref and release record before attempting another repair or deployment.</p>
            )}
            {snapshot.devices.length === 0 && <p className="text-sm text-muted-foreground">No enrolled devices.</p>}
            {snapshot.devices.map((device) => {
              const online = !device.revoked && device.lastSeenAt !== null && device.lastSeenAt <= Date.now() && Date.now() - device.lastSeenAt < 45_000;
              const ready = online && device.bridgeAvailable && Boolean(device.checkout ?? device.workspace) && !device.holdReason;
              const active = snapshot.jobs.some((job) => job.deviceId === device.id && ['queued', 'leased', 'paused'].includes(job.state));
              const pending = snapshot.jobs.some(job => job.deviceId === device.id && job.state === 'tested' &&
                !snapshot.jobs.some(release => release.parentRepairId === job.id && release.state === 'deployed'));
              const reconciling = snapshot.jobs.some(job => job.deviceId === device.id && job.batch &&
                !['queued', 'leased', 'paused'].includes(job.state) && job.lifecycleReconciliationRequired);
              return (
                <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="break-words">{device.name}</span> <Badge variant="secondary">{device.revoked ? 'Revoked' : online ? 'Online' : 'Offline'}</Badge></div>
                    <p className="text-xs text-muted-foreground">Runner: {!online ? 'not connected' : active ? 'busy' : pending ? 'tested candidate awaits separate Deploy' : device.holdReason ?? (!device.bridgeAvailable ? 'bridge unavailable' : ready ? 'Connected - waiting' : 'checkout unavailable')}</p>
                    <p className="text-xs text-muted-foreground">Local opt-ins: review {device.allowReadOnly ? 'on' : 'off'} / repair {device.allowRepair ? 'on' : 'off'} / deploy {device.allowDeploy ? 'on' : 'off'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy || !ready || active || pending || reconciling || !device.allowReadOnly}
                      onClick={() => void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'review' })}>Review errors</Button>
                    <Button size="sm" disabled={busy || !ready || active || pending || reconciling || !device.allowRepair || snapshot.releaseNeedsReconciliation}
                      onClick={() => void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'repair' })}>Run error batch</Button>
                    <Button size="sm" variant="ghost" disabled={busy || device.revoked}
                      onClick={() => void submit({ op: 'revoke-device', deviceId: device.id })}>Revoke device</Button>
                  </div>
                </div>
              );
            })}
            {(() => {
              const attention = (job: Snapshot['jobs'][number]) => ['queued', 'leased', 'paused', 'unknown'].includes(job.state) ||
                (job.batch && (job.batch.remaining > 0 || job.batch.lifecycle !== 'applied' ||
                  ((job.batch.counts.held > 0 || job.batch.counts.failed > 0) && !snapshot.jobs.some(later =>
                    later.deviceId === job.deviceId && later.createdAt > job.createdAt && later.batch?.lifecycle === 'applied')))) ||
                (job.state === 'tested' && !snapshot.jobs.some(release => release.parentRepairId === job.id && release.state === 'deployed'));
              const activeJobs = snapshot.jobs.filter(attention);
              const previousJobs = snapshot.jobs.filter(job => !attention(job));
              const renderJobs = (jobs: Snapshot['jobs']) => (<>
              {jobs.map((job) => (
                <div key={job.id} className="min-w-0 space-y-3 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium capitalize">{job.action}</span> <Badge variant={job.state === 'failed' || job.state === 'unknown' ? 'destructive' : 'secondary'}>{job.state}</Badge> <time className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('en-GB')}</time></div>
                  {job.reason && <p className="text-muted-foreground">{job.reason}</p>}
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
                  {job.action === 'repair' && job.state === 'tested' && job.candidate && !snapshot.jobs.some((entry) => entry.parentRepairId === job.id) && (
                    <Button variant="outline" size="sm" disabled={busy || snapshot.releaseNeedsReconciliation || Boolean(job.batch && job.batch.lifecycle !== 'applied')}
                      onClick={() => {
                        if (job.candidate) { setConfirmed(false); setReleaseMode('full'); setConfirmation({ repairJobId: job.id, candidate: job.candidate, release: job.checks?.release }); }
                      }}>Deploy: review exact candidate</Button>
                  )}
                </div>
              ))}
              </>);
              return <>
                <div className="divide-y divide-border rounded-lg border border-border" aria-label="Current Fixerrors activity">
                  <h3 className="p-3 text-sm font-semibold">Current activity</h3>
                  {activeJobs.length ? renderJobs(activeJobs) : <p className="p-3 text-sm text-muted-foreground">No active jobs or deployment decisions.</p>}
                </div>
                <div className="rounded-lg border border-border">
                  <button type="button" aria-expanded={historyOpen} aria-controls="fixerrors-history"
                    onClick={() => setHistoryOpen(open => !open)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg p-3 text-left text-sm font-semibold hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <span>Previous Fixerrors activity ({previousJobs.length})</span><span aria-hidden="true">{historyOpen ? '-' : '+'}</span>
                  </button>
                  <div id="fixerrors-history" hidden={!historyOpen} className="divide-y divide-border border-t border-border">
                    {historyOpen && (previousJobs.length ? renderJobs(previousJobs) : <p className="p-3 text-sm text-muted-foreground">No previous activity.</p>)}
                  </div>
                </div>
              </>;
            })()}
            {confirmation && confirmationValid && (
              <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={(event) => {
                event.preventDefault();
                if (confirmed && confirmationValid && !busy && !snapshot.releaseNeedsReconciliation) void submit({
                  op: 'approve-deploy', requestId: crypto.randomUUID(),
                  repairJobId: confirmation.repairJobId, candidate: confirmation.candidate,
                  confirmation: true, releaseMode,
                });
              }}>
                <h3 className="font-semibold">Separate Deploy confirmation</h3>
                <p className="text-sm text-muted-foreground">Approve only this tested candidate. Any commit, tree or check-evidence change invalidates approval. An enabled runner may deploy after this separate confirmation.</p>
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
                  <Button type="submit" className="h-auto min-h-9 whitespace-normal text-center" disabled={busy || snapshot.releaseNeedsReconciliation || !confirmed}>{busy ? 'Recording approval...' : 'Confirm Deploy for exact candidate'}</Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => { setConfirmation(null); setConfirmed(false); }}>Cancel</Button>
                </div>
              </form>
            )}
          </>
        )}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void refresh()}>Refresh companion state</Button>
      </CardContent>
    </Card>
  );
}
