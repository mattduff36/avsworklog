'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { ReleaseMode } from '@/lib/fixerrors/protocol';

// Display-only estimates; elapsed time never grants release authority.
export function deploymentEstimate(mode: ReleaseMode, elapsedMs: number, deploying: boolean, confirmed: boolean) {
  if (confirmed) return 100;
  const checksMs = (mode === 'full' ? 8 : 2) * 60_000;
  const buildMs = 4 * 60_000;
  const checksShare = 90 * checksMs / (checksMs + buildMs);
  const elapsed = Math.max(0, elapsedMs);
  return deploying
    ? Math.min(90, checksShare + (90 - checksShare) * elapsed / buildMs)
    : Math.min(checksShare, checksShare * elapsed / checksMs);
}

export function FixerrorsDeploymentProgress({ mode, release, permission, stale }: {
  mode: ReleaseMode;
  release?: { state: string; createdAt: number };
  permission: string;
  stale: boolean;
}) {
  const [startedAt] = useState(() => Date.now());
  const [clock, setClock] = useState(() => Date.now());
  const confirmed = release?.state === 'deployed';
  const stopped = Boolean(release && !['queued', 'leased', 'deployed'].includes(release.state)) ||
    (!release && !['pending', 'consumed'].includes(permission));
  const active = !confirmed && !stopped && !stale;
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setClock(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [active]);
  const percent = deploymentEstimate(mode, clock - (release?.createdAt ?? startedAt), Boolean(release), confirmed);
  const label = confirmed ? 'Deployment confirmed live'
    : stale ? 'Status unavailable — waiting for a fresh update'
    : stopped ? 'Deployment stopped or unconfirmed — inspect run details'
    : release ? percent >= 90 ? 'Waiting for live confirmation — taking longer than estimated' : 'Deploying — usually about 4 minutes'
    : `Final checks and approval — allow about ${mode === 'full' ? 8 : 2} minutes, then 4 minutes to deploy`;
  return <section aria-label="Automatic deployment progress" className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-2 font-medium">
        {active && <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin motion-reduce:animate-none" />}
        Auto-deployment{!confirmed && ' (estimated)'}
      </span>
      <span>{Math.floor(percent)}%</span>
    </div>
    <Progress className="h-2" indicatorClassName="bg-red-500 duration-1000 motion-reduce:transition-none"
      aria-label="Automatic deployment estimate" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={Math.floor(percent)} aria-valuetext={label} value={percent} />
    <p className="text-xs text-muted-foreground" role="status">{label}</p>
  </section>;
}
