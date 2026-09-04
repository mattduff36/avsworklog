/**
 * Human-only TEE progress. Never treat percent/ETA as evidence or authority.
 * Progress advances only from real reporter events. 100% only at terminal complete().
 */

export type TeeProgressStatus = 'pending' | 'running' | 'passed' | 'failed';

export interface TeeProgressStageSpec {
  id: string;
  label: string;
  weight: number;
}

export interface TeeProgressWorkerSnapshot {
  id: string;
  label: string;
  status: TeeProgressStatus;
  startedAtMs: number | null;
  endedAtMs: number | null;
  detail?: string;
  completed?: number;
  total?: number | null;
  current?: string;
  failures?: string[];
}

export interface TeeProgressStageSnapshot {
  id: string;
  label: string;
  weight: number;
  status: TeeProgressStatus;
  startedAtMs: number | null;
  endedAtMs: number | null;
  ratio?: number | null;
  detail?: string;
}

export interface TeeProgressSnapshot {
  title: string;
  subtitle?: string;
  percent: number;
  elapsedMs: number;
  etaMs: number | null;
  status: TeeProgressStatus;
  currentStageId: string | null;
  workerParentStageId: string | null;
  nowMs: number;
  stages: TeeProgressStageSnapshot[];
  workers: TeeProgressWorkerSnapshot[];
  lines: string[];
  heartbeatCount: number;
  completed: boolean;
}

export interface TeeWorkerProgressUpdate {
  detail?: string;
  startedAtMs?: number;
  endedAtMs?: number;
  completed?: number;
  total?: number | null;
  current?: string;
  failures?: string[];
}

export interface TeeStageProgressUpdate {
  detail?: string;
  ratio?: number | null;
}

export interface TeeProgressReporter {
  start(subtitle?: string): void;
  setSubtitle(subtitle: string): void;
  stageStart(id: string, detail?: string): void;
  stageUpdate(id: string, extra?: TeeStageProgressUpdate): void;
  stageFinish(id: string, status: 'passed' | 'failed', detail?: string): void;
  setWorkers(workers: Array<{ id: string; label: string }>): void;
  workerUpdate(id: string, status: TeeProgressStatus, extra?: TeeWorkerProgressUpdate): void;
  heartbeat(): void;
  complete(status: 'passed' | 'failed', detail?: string): void;
  snapshot(): TeeProgressSnapshot;
}

const DEFAULT_HEARTBEAT_MS = 15_000;
const BAR_WIDTH = 10;

export function notifyDisplayProgress(fn: () => void): void {
  try {
    fn();
  } catch {
    /* display-only; never fail the underlying job */
  }
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return Math.floor(value);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function clampSuiteProgress(
  completed: number,
  total: number | null | undefined
): { completed: number; total: number | null } {
  const safeCompleted = Number.isFinite(completed) ? Math.max(0, Math.floor(completed)) : 0;
  if (total == null || !Number.isFinite(total) || total < 0) {
    return { completed: safeCompleted, total: null };
  }
  const safeTotal = Math.floor(total);
  return { completed: Math.min(safeCompleted, safeTotal), total: safeTotal };
}

export function renderProgressBar(params: {
  status: TeeProgressStatus;
  ratio?: number | null;
  pulse?: number;
}): string {
  if (params.status === 'passed' || params.status === 'failed') {
    return `[${'█'.repeat(BAR_WIDTH)}]`;
  }
  if (params.status === 'pending') {
    return `[${'░'.repeat(BAR_WIDTH)}]`;
  }
  if (typeof params.ratio === 'number' && Number.isFinite(params.ratio)) {
    const filled = Math.max(0, Math.min(BAR_WIDTH, Math.round(Math.max(0, Math.min(1, params.ratio)) * BAR_WIDTH)));
    return `[${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}]`;
  }
  const pulse = params.pulse ?? 0;
  const filled = 3 + (pulse % 5);
  return `[${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}]`;
}

function statusLabel(status: TeeProgressStatus): string {
  if (status === 'passed') return 'PASS';
  if (status === 'failed') return 'FAIL';
  if (status === 'running') return 'RUNNING';
  return 'WAITING';
}

function workerRatio(worker: TeeProgressWorkerSnapshot): number | null {
  if (worker.total == null || worker.total <= 0) return null;
  return Math.min(1, Math.max(0, (worker.completed ?? 0) / worker.total));
}

function formatCount(worker: TeeProgressWorkerSnapshot): string {
  if (worker.total != null) return `${worker.completed ?? 0}/${worker.total}`;
  if (worker.completed != null) return String(worker.completed);
  return '';
}

function suiteEtaMs(worker: TeeProgressWorkerSnapshot, nowMs: number): number | null {
  if (worker.status !== 'running' || worker.startedAtMs === null) return null;
  const clamped = clampSuiteProgress(worker.completed ?? 0, worker.total);
  if (clamped.total == null || clamped.completed <= 0 || clamped.completed >= clamped.total) {
    return null;
  }
  const elapsed = Math.max(1, nowMs - worker.startedAtMs);
  const remaining = (elapsed / clamped.completed) * (clamped.total - clamped.completed);
  return Math.round(remaining);
}

export function formatDurationMs(ms: number): string {
  return formatDuration(ms);
}

export function renderTeeProgressLines(snapshot: TeeProgressSnapshot): string[] {
  const etaPart =
    snapshot.etaMs === null ? '' : ` · ~${formatDuration(snapshot.etaMs)} remaining`;
  const overallRatio = (snapshot.completed ? 100 : snapshot.percent) / 100;
  const labelWidth = Math.max(
    20,
    ...snapshot.stages.map((stage) => stage.label.length),
    'Overall'.length
  );
  const lines = [
    `${snapshot.title}${snapshot.subtitle ? ` — ${snapshot.subtitle}` : ''}`,
    '',
    `${'Overall'.padEnd(labelWidth, ' ')} ${renderProgressBar({
      status: snapshot.completed ? snapshot.status : 'running',
      ratio: overallRatio,
      pulse: snapshot.heartbeatCount,
    })} ${String(snapshot.completed ? 100 : snapshot.percent).padStart(3, ' ')}%   ${formatDuration(
      snapshot.elapsedMs
    )}${etaPart}`,
    '',
  ];
  const parentId = snapshot.workerParentStageId;
  const workers = parentId ? snapshot.workers : [];
  for (const stage of snapshot.stages) {
    const duration =
      stage.startedAtMs === null
        ? ''
        : formatDuration((stage.endedAtMs ?? snapshot.nowMs) - stage.startedAtMs);
    lines.push(
      `${stage.label.padEnd(labelWidth, ' ')} ${renderProgressBar({
        status: stage.status,
        ratio: stage.status === 'running' ? stage.ratio ?? null : undefined,
        pulse: snapshot.heartbeatCount,
      })} ${statusLabel(stage.status).padEnd(7, ' ')} ${duration}`.trimEnd()
    );
    if (parentId !== stage.id) continue;
    workers.forEach((worker, index) => {
      const isLast = index === workers.length - 1;
      const branch = isLast ? '└─' : '├─';
      const ratio = workerRatio(worker);
      const count = formatCount(worker);
      const workerDuration =
        worker.startedAtMs === null
          ? ''
          : formatDuration((worker.endedAtMs ?? snapshot.nowMs) - worker.startedAtMs);
      const eta = suiteEtaMs(worker, snapshot.nowMs);
      const etaText = eta === null ? '' : ` · ~${formatDuration(eta)}`;
      lines.push(
        `  ${branch} ${worker.label.padEnd(Math.max(16, worker.label.length), ' ')} ${renderProgressBar({
          status: worker.status,
          ratio,
          pulse: snapshot.heartbeatCount,
        })} ${count ? `${count} ` : ''}${statusLabel(worker.status)}${
          workerDuration ? ` ${workerDuration}` : ''
        }${etaText}`.trimEnd()
      );
      if (worker.status === 'running' && worker.current) {
        lines.push(`       Current: ${worker.current}`);
      }
      for (const failure of worker.failures ?? []) {
        lines.push(`       FAIL: ${failure}`);
      }
    });
  }
  return lines;
}

export function createTeeProgressReporter(options: {
  title: string;
  stages: TeeProgressStageSpec[];
  stream?: NodeJS.WritableStream;
  isTTY?: boolean;
  now?: () => number;
  heartbeatMs?: number;
}): TeeProgressReporter {
  const stages = options.stages.map((stage) => ({
    ...stage,
    weight: stage.weight > 0 ? stage.weight : 1,
    status: 'pending' as TeeProgressStatus,
    startedAtMs: null as number | null,
    endedAtMs: null as number | null,
    ratio: null as number | null,
    detail: undefined as string | undefined,
  }));
  const totalWeight = stages.reduce((sum, stage) => sum + stage.weight, 0);
  const now = options.now ?? (() => Date.now());
  const stream = options.stream;
  const isTTY = options.isTTY ?? Boolean(stream && 'isTTY' in stream && stream.isTTY);
  const startedAt = now();
  let subtitle: string | undefined;
  let currentStageId: string | null = null;
  let workerParentStageId: string | null = null;
  let percent = 0;
  let completed = false;
  let terminalStatus: TeeProgressStatus = 'running';
  let heartbeatCount = 0;
  let lastRenderLineCount = 0;
  let etaMs: number | null = null;
  let lastEtaSample:
    | {
        elapsedMs: number;
        completedWeight: number;
      }
    | undefined;
  const workers = new Map<string, TeeProgressWorkerSnapshot>();
  const lines: string[] = [];

  function elapsedMs(): number {
    return Math.max(0, now() - startedAt);
  }

  function completedWeight(): number {
    return stages
      .filter((stage) => stage.status === 'passed' || stage.status === 'failed')
      .reduce((sum, stage) => sum + stage.weight, 0);
  }

  function workerFraction(worker: TeeProgressWorkerSnapshot): number {
    if (worker.status === 'passed' || worker.status === 'failed') return 1;
    if (worker.status !== 'running') return 0;
    const ratio = workerRatio(worker);
    return ratio === null ? 0 : ratio;
  }

  function stagePartialWeight(stage: (typeof stages)[number]): number {
    if (stage.status !== 'running') return 0;
    const listed = [...workers.values()];
    if (listed.length > 0 && workerParentStageId === stage.id) {
      const fraction = listed.reduce((sum, worker) => sum + workerFraction(worker), 0) / listed.length;
      return stage.weight * fraction;
    }
    if (typeof stage.ratio === 'number' && Number.isFinite(stage.ratio)) {
      return stage.weight * Math.max(0, Math.min(1, stage.ratio));
    }
    return 0;
  }

  function currentPartialWeight(): number {
    return stages.reduce((sum, stage) => sum + stagePartialWeight(stage), 0);
  }

  function recomputePercent(): number {
    if (completed) return 100;
    if (totalWeight <= 0) return 0;
    const raw = ((completedWeight() + currentPartialWeight()) / totalWeight) * 99;
    return clampPercent(Math.min(99, raw));
  }

  function updateEta(): void {
    const completedW = completedWeight() + currentPartialWeight();
    const elapsed = elapsedMs();
    if (completedW <= 0 || elapsed < 3_000) {
      etaMs = null;
      return;
    }
    const remaining = totalWeight - completedW;
    if (remaining <= 0) {
      etaMs = null;
      return;
    }
    if (!lastEtaSample || completedW > lastEtaSample.completedWeight) {
      lastEtaSample = { elapsedMs: elapsed, completedWeight: completedW };
    }
    const rate = completedW / elapsed;
    if (rate <= 0) {
      etaMs = null;
      return;
    }
    etaMs = Math.round(remaining / rate);
  }

  function bumpPercent(): void {
    const next = recomputePercent();
    percent = Math.max(percent, next);
    updateEta();
  }

  function pushLine(line: string): void {
    lines.push(line);
    if (lines.length > 80) lines.splice(0, lines.length - 80);
  }

  function captureSnapshot(): TeeProgressSnapshot {
    return {
      title: options.title,
      subtitle,
      percent: completed ? 100 : percent,
      elapsedMs: elapsedMs(),
      etaMs: completed ? null : etaMs,
      status: terminalStatus,
      currentStageId,
      workerParentStageId,
      nowMs: now(),
      stages: stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        weight: stage.weight,
        status: stage.status,
        startedAtMs: stage.startedAtMs,
        endedAtMs: stage.endedAtMs,
        ratio: stage.ratio,
        detail: stage.detail,
      })),
      workers: [...workers.values()].map((worker) => ({
        ...worker,
        failures: worker.failures ? [...worker.failures] : undefined,
      })),
      lines: [...lines],
      heartbeatCount,
      completed,
    };
  }

  function writeOutput(mode: 'full' | 'status' | 'tick' = 'tick'): void {
    if (!stream) return;
    const rendered = renderTeeProgressLines(captureSnapshot());
    if (isTTY) {
      if (lastRenderLineCount > 0) {
        stream.write(`\x1b[${lastRenderLineCount}A`);
      }
      for (const line of rendered) {
        stream.write(`\x1b[2K${line}\n`);
      }
      lastRenderLineCount = rendered.length;
      return;
    }
    if (mode === 'tick') return;
    const compact = `[${String(percent).padStart(3, ' ')}%] ${
      stages.find((stage) => stage.id === currentStageId)?.label ?? options.title
    }`;
    const extras = [...workers.values()]
      .filter((worker) => worker.status === 'running' || mode === 'full')
      .map((worker) => {
        const count = worker.total != null ? `${worker.completed ?? 0}/${worker.total}` : '';
        return `${worker.label} ${statusLabel(worker.status)}${count ? ` ${count}` : ''}`;
      })
      .join(' · ');
    const line = extras ? `${compact} · ${extras}` : compact;
    stream.write(`${line}\n`);
    pushLine(line);
  }

  const reporter: TeeProgressReporter = {
    start(nextSubtitle?: string) {
      notifyDisplayProgress(() => {
        if (nextSubtitle) subtitle = nextSubtitle;
        terminalStatus = 'running';
        bumpPercent();
        writeOutput('full');
      });
    },
    setSubtitle(nextSubtitle: string) {
      notifyDisplayProgress(() => {
        subtitle = nextSubtitle;
      });
    },
    stageStart(id: string, detail?: string) {
      notifyDisplayProgress(() => {
        if (completed) return;
        const stage = stages.find((row) => row.id === id);
        if (!stage) return;
        currentStageId = id;
        stage.status = 'running';
        stage.startedAtMs = stage.startedAtMs ?? now();
        stage.endedAtMs = null;
        if (detail) stage.detail = detail;
        bumpPercent();
        const line = `[${String(percent).padStart(3, ' ')}%] ${stage.label}${detail ? ` ${detail}` : ''}`;
        pushLine(line);
        writeOutput('status');
      });
    },
    stageUpdate(id: string, extra?: TeeStageProgressUpdate) {
      notifyDisplayProgress(() => {
        if (completed) return;
        const stage = stages.find((row) => row.id === id);
        if (!stage || stage.status !== 'running') return;
        if (extra?.detail) stage.detail = extra.detail;
        if (extra?.ratio !== undefined) {
          stage.ratio =
            extra.ratio == null || !Number.isFinite(extra.ratio)
              ? null
              : Math.max(0, Math.min(1, extra.ratio));
        }
        bumpPercent();
        writeOutput('tick');
      });
    },
    stageFinish(id: string, status: 'passed' | 'failed', detail?: string) {
      notifyDisplayProgress(() => {
        if (completed) return;
        const stage = stages.find((row) => row.id === id);
        if (!stage) return;
        stage.status = status;
        stage.endedAtMs = now();
        stage.ratio = 1;
        if (detail) stage.detail = detail;
        if (currentStageId === id) {
          currentStageId = stages.find((row) => row.status === 'running')?.id ?? null;
        }
        bumpPercent();
        const duration =
          stage.startedAtMs === null ? '' : `   ${formatDuration(stage.endedAtMs - stage.startedAtMs)}`;
        const line = `[${String(percent).padStart(3, ' ')}%] ${stage.label.padEnd(40, ' ')} ${statusLabel(status)}${duration}${
          detail ? `  ${detail}` : ''
        }`;
        pushLine(line);
        writeOutput('status');
      });
    },
    setWorkers(nextWorkers) {
      notifyDisplayProgress(() => {
        workers.clear();
        workerParentStageId = currentStageId;
        for (const worker of nextWorkers) {
          workers.set(worker.id, {
            id: worker.id,
            label: worker.label,
            status: 'pending',
            startedAtMs: null,
            endedAtMs: null,
          });
        }
        bumpPercent();
        writeOutput('full');
      });
    },
    workerUpdate(id, status, extra) {
      notifyDisplayProgress(() => {
        const existing = workers.get(id);
        if (!existing) return;
        const statusChanged = existing.status !== status;
        existing.status = status;
        if (extra?.detail) existing.detail = extra.detail;
        if (extra?.current) existing.current = extra.current;
        if (extra?.failures) existing.failures = [...extra.failures];
        if (extra?.completed != null || extra?.total !== undefined) {
          const clamped = clampSuiteProgress(
            extra.completed ?? existing.completed ?? 0,
            extra.total ?? existing.total
          );
          existing.completed = clamped.completed;
          existing.total = clamped.total;
        }
        if (extra?.startedAtMs != null) {
          existing.startedAtMs = extra.startedAtMs;
        } else if (status === 'running') {
          existing.startedAtMs = existing.startedAtMs ?? now();
        }
        if (status === 'passed' || status === 'failed') {
          existing.endedAtMs = extra?.endedAtMs ?? now();
        }
        bumpPercent();
        writeOutput(statusChanged ? 'status' : 'tick');
      });
    },
    heartbeat() {
      notifyDisplayProgress(() => {
        if (completed) return;
        heartbeatCount += 1;
        bumpPercent();
        writeOutput('status');
      });
    },
    complete(status, detail) {
      notifyDisplayProgress(() => {
        if (completed) return;
        completed = true;
        terminalStatus = status;
        percent = 100;
        etaMs = null;
        const line = `[100%] ${options.title.padEnd(40, ' ')} ${statusLabel(status)}   ${formatDuration(elapsedMs())}${
          detail ? `  ${detail}` : ''
        }`;
        pushLine(line);
        writeOutput('full');
      });
    },
    snapshot() {
      return captureSnapshot();
    },
  };

  return reporter;
}

export const TEE_PROGRESS_DEFAULT_HEARTBEAT_MS = DEFAULT_HEARTBEAT_MS;
