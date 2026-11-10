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
      toast.success(command.op === 'approve-deploy' ? 'Exact-candidate deployment approved for the selected checks' : 'Companion request recorded');
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
          A Windows companion handles review and bounded repair. Deployment requires separate approval of the tested commit.
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
              const ready = online && device.bridgeAvailable && Boolean(device.workspace);
              const active = snapshot.jobs.some((job) => job.deviceId === device.id && ['queued', 'leased'].includes(job.state));
              return (
                <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm font-medium"><span className="break-words">{device.name}</span> <Badge variant="secondary">{device.revoked ? 'Revoked' : online ? 'Online' : 'Offline'}</Badge></div>
                    <p className="text-xs text-muted-foreground">Runner: {ready ? active ? 'busy' : 'ready' : !online ? 'not connected' : !device.bridgeAvailable ? 'bridge unavailable' : 'checkout unavailable'}</p>
                    <p className="text-xs text-muted-foreground">Local opt-ins: review {device.allowReadOnly ? 'on' : 'off'} / repair {device.allowRepair ? 'on' : 'off'} / deploy {device.allowDeploy ? 'on' : 'off'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy || !ready || active || !device.allowReadOnly}
                      onClick={() => void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'review' })}>Review errors</Button>
                    <Button size="sm" variant="outline" disabled={busy || !ready || active || !device.allowRepair || snapshot.releaseNeedsReconciliation}
                      onClick={() => void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'repair' })}>Request bounded repair</Button>
                    <Button size="sm" variant="ghost" disabled={busy || device.revoked}
                      onClick={() => void submit({ op: 'revoke-device', deviceId: device.id })}>Revoke device</Button>
                  </div>
                </div>
              );
            })}
            <div className="divide-y divide-border rounded-lg border border-border" aria-label="Recent Fixerrors jobs">
              <h3 className="p-3 text-sm font-semibold">Latest activity</h3>
              {snapshot.jobs.length === 0 && <p className="p-3 text-sm text-muted-foreground">No jobs yet.</p>}
              {snapshot.jobs.map((job, index) => (
                <div key={job.id} className="min-w-0 space-y-3 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2"><span className="font-medium capitalize">{job.action}</span> <Badge variant={job.state === 'failed' || job.state === 'unknown' ? 'destructive' : 'secondary'}>{job.state}</Badge>{index === 0 && <span className="text-xs text-muted-foreground">Latest job</span>} <time className="text-xs text-muted-foreground">{new Date(job.createdAt).toLocaleString('en-GB')}</time></div>
                  {job.reason && <p className="text-muted-foreground">{job.reason}</p>}
                  {job.approval && <p className="text-xs text-muted-foreground">{(job.approval.releaseMode ?? 'full') === 'targeted' ? 'Targeted checks (urgent)' : 'Full checks (fap)'} / separately confirmed {new Date(job.approval.confirmedAt).toLocaleString('en-GB')}</p>}
                  {job.candidate && <CandidateDetails candidate={job.candidate} release={job.checks?.release} />}
                  {job.action === 'repair' && job.state === 'tested' && job.candidate && !snapshot.jobs.some((entry) => entry.parentRepairId === job.id) && (
                    <Button variant="outline" size="sm" disabled={busy || snapshot.releaseNeedsReconciliation}
                      onClick={() => {
                        if (job.candidate) { setConfirmed(false); setReleaseMode('full'); setConfirmation({ repairJobId: job.id, candidate: job.candidate, release: job.checks?.release }); }
                      }}>Deploy: review exact candidate</Button>
                  )}
                </div>
              ))}
            </div>
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
