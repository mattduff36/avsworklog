'use client';

import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { toast } from 'sonner';
import { useAuth } from '@/lib/hooks/useAuth';
import { adminResponseSchema, FIXERRORS_PRODUCTION_ORIGIN, type AdminCommand, type Candidate, type CheckEvidence } from '@/lib/fixerrors/protocol';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

type Snapshot = z.infer<typeof adminResponseSchema>;
type Confirmation = { repairJobId: string; candidate: Candidate; release?: CheckEvidence['release'] };

export function FixerrorsControlPanel() {
  const { isActualSuperAdmin, isViewingAs } = useAuth();
  const allowed = isActualSuperAdmin && !isViewingAs;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [phrase, setPhrase] = useState('');
  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/debug/fixerrors', { cache: 'no-store' });
      if (!response.ok) throw new Error('Fixerrors controls unavailable or access denied');
      setSnapshot(adminResponseSchema.parse(await response.json()));
      setFailure(null);
    } catch {
      setSnapshot(null);
      setFailure('Unable to load local Fixerrors controls. Existing error logs are unaffected.');
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 15_000);
    return () => clearInterval(timer);
  }, [allowed, refresh]);

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
      toast.success(command.op === 'approve-deploy' ? 'Exact-candidate approval recorded; no automatic deployment' : 'Local request recorded');
      setConfirmation(null);
      setPhrase('');
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Local request failed');
    } finally {
      setBusy(false);
    }
  }

  if (!allowed) return null;
  return (
    <Card className="border-border">
      <CardHeader>
        <CardTitle className="text-lg">Fixerrors companion</CardTitle>
        <CardDescription>
          A Windows companion handles review and bounded repair. Deployment requires separate approval of the tested commit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {failure && <p role="alert" className="text-sm text-destructive">{failure}</p>}
        {!snapshot && !failure && <p role="status" className="text-sm text-muted-foreground">Loading local controls...</p>}
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
            {snapshot.devices.length === 0 && <p className="text-sm text-muted-foreground">No locally provisioned devices.</p>}
            {snapshot.devices.map((device) => {
              const online = !device.revoked && device.lastSeenAt !== null && Date.now() - device.lastSeenAt < 45_000;
              const active = snapshot.jobs.some((job) => job.deviceId === device.id && ['queued', 'leased'].includes(job.state));
              return (
                <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3">
                  <div>
                    <div className="text-sm font-medium">{device.name} <Badge variant="secondary">{device.revoked ? 'Revoked' : online ? 'Online' : 'Offline'}</Badge></div>
                    <p className="text-xs text-muted-foreground">Read-only {device.allowReadOnly ? 'on' : 'off'} / repair {device.allowRepair ? 'on' : 'off'} / deploy {device.allowDeploy ? 'on' : 'off'}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy || !online || active || !device.allowReadOnly}
                      onClick={() => void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'review' })}>Review errors</Button>
                    <Button size="sm" variant="outline" disabled={busy || !online || active || !device.allowRepair || snapshot.releaseNeedsReconciliation}
                      onClick={() => void submit({ op: 'enqueue', requestId: crypto.randomUUID(), deviceId: device.id, action: 'repair' })}>Request bounded repair</Button>
                    <Button size="sm" variant="outline" disabled={busy || device.revoked}
                      onClick={() => void submit({ op: 'revoke-device', deviceId: device.id })}>Revoke device</Button>
                  </div>
                </div>
              );
            })}
            <div className="space-y-2" aria-label="Recent Fixerrors jobs">
              {snapshot.jobs.length === 0 && <p className="text-sm text-muted-foreground">No local jobs.</p>}
              {snapshot.jobs.map((job) => (
                <div key={job.id} className="space-y-2 rounded-lg border border-border p-3 text-sm">
                  <div className="break-all">{job.action} <Badge variant="secondary">{job.state}</Badge> <span className="text-xs text-muted-foreground">{job.id}</span></div>
                  {job.reason && <p className="text-muted-foreground">{job.reason}</p>}
                  {job.approval && <p className="text-xs text-muted-foreground">Separately confirmed {new Date(job.approval.confirmedAt).toLocaleString()}</p>}
                  {job.candidate && <p className="break-all font-mono text-xs text-muted-foreground">HEAD {job.candidate.head}<br />Tree {job.candidate.tree}<br />Checks SHA-256 {job.candidate.checksSha256}</p>}
                  {job.checks?.release && <p className="break-all font-mono text-xs text-muted-foreground">Worker candidate SHA-256 {job.checks.release.candidateSha256}<br />Prepared evidence SHA-256 {job.checks.release.testEvidenceSha256}</p>}
                  {job.action === 'repair' && job.state === 'tested' && job.candidate && (
                    <Button variant="outline" size="sm" disabled={busy || snapshot.releaseNeedsReconciliation}
                      onClick={() => {
                        if (job.candidate) { setPhrase(''); setConfirmation({ repairJobId: job.id, candidate: job.candidate, release: job.checks?.release }); }
                      }}>Deploy: review exact candidate</Button>
                  )}
                </div>
              ))}
            </div>
            {confirmation && (
              <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={(event) => {
                event.preventDefault();
                if (phrase === 'DEPLOY EXACT TESTED CANDIDATE') void submit({
                  op: 'approve-deploy', requestId: crypto.randomUUID(),
                  repairJobId: confirmation.repairJobId, candidate: confirmation.candidate,
                  confirmation: 'DEPLOY EXACT TESTED CANDIDATE',
                });
              }}>
                <h3 className="font-semibold">Separate Deploy confirmation</h3>
                <p className="text-sm">Approve only this tested candidate. Any HEAD, tree or check-evidence change invalidates approval. No automatic deploy; the current executor refuses execution.</p>
                <p className="break-all font-mono text-xs">HEAD {confirmation.candidate.head}<br />Tree {confirmation.candidate.tree}<br />Checks SHA-256 {confirmation.candidate.checksSha256}</p>
                {confirmation.release && <p className="break-all font-mono text-xs">Worker candidate SHA-256 {confirmation.release.candidateSha256}<br />Prepared evidence SHA-256 {confirmation.release.testEvidenceSha256}</p>}
                <label htmlFor="fixerrors-deploy-phrase" className="block text-sm">Type DEPLOY EXACT TESTED CANDIDATE</label>
                <Input id="fixerrors-deploy-phrase" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" disabled={busy} />
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" disabled={busy || snapshot.releaseNeedsReconciliation || phrase !== 'DEPLOY EXACT TESTED CANDIDATE'}>{busy ? 'Recording approval...' : 'Confirm Deploy for exact candidate'}</Button>
                  <Button type="button" variant="outline" disabled={busy} onClick={() => { setConfirmation(null); setPhrase(''); }}>Cancel</Button>
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
