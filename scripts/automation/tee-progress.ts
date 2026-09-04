/**
 * Human-only TEE progress. Never treat percent/ETA as evidence or authority.
 * Progress advances only from real reporter events. 100% only at terminal complete().
 *
 * TTY layout matches the FFTS live dashboard: alternate screen, hierarchical
 * stages, block bars, WAITING/RUNNING/PASS/FAIL. Non-TTY and CI stay compact
 * and newline-safe with no control codes.
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
  restoreTerminal(): void;
  snapshot(): TeeProgressSnapshot;
}

const DEFAULT_HEARTBEAT_MS = 15_000;
const ETA_MIN_ELAPSED_MS = 20_000;
const ETA_MIN_FRACTION = 0.15;
const BAR_WIDTH = 10;
const LABEL_WIDTH = 20;
const ANSI_CLEAR_DOWN = '\u001b[J';
export const ANSI_ENTER_ALT_SCREEN = '\u001b[?1049h';
export const ANSI_LEAVE_ALT_SCREEN = '\u001b[?1049l';
export const ANSI_HIDE_CURSOR = '\u001b[?25l';
export const ANSI_SHOW_CURSOR = '\u001b[?25h';
export const ANSI_CURSOR_HOME = '\u001b[H';
export const ANSI_ERASE_SCREEN = '\u001b[2J';

export function notifyDisplayProgress(fn: () => void): void {
  try {
    fn();
  } catch {
    /* display-only; never fail the underlying job */
  }
}

export function isCursorInteractiveProgressHost(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.CI === 'true' || env.CI === '1') return false;
  if (env.TEE_VERIFY_PROGRESS === 'off' || env.TEE_VERIFY_PROGRESS === 'plain') return false;
  if (env.TEE_VERIFY_PROGRESS === 'live') return true;
  const program = (env.TERM_PROGRAM ?? '').toLowerCase();
  if (program === 'vscode' || program === 'cursor') return true;
  return Boolean(env.CURSOR_AGENT && env.VSCODE_PID);
}

export function resolveProgressIsTty(params: {
  env?: NodeJS.ProcessEnv;
  stdoutIsTty?: boolean;
  stderrIsTty?: boolean;
}): boolean {
  const env = params.env ?? process.env;
  if (params.stderrIsTty === true || params.stdoutIsTty === true) return true;
  return isCursorInteractiveProgressHost(env);
}

export function resolveInteractiveProgress(params?: {
  env?: NodeJS.ProcessEnv;
  stdoutIsTty?: boolean;
  stderrIsTty?: boolean;
}): { interactive: boolean; machine: boolean } {
  const env = params?.env ?? process.env;
  const interactive = resolveProgressIsTty({
    env,
    stdoutIsTty: params?.stdoutIsTty ?? Boolean(process.stdout.isTTY),
    stderrIsTty: params?.stderrIsTty ?? Boolean(process.stderr.isTTY),
  });
  const machine = shouldUseMachineProgress(env, interactive);
  return { interactive: !machine, machine };
}

export function shouldUseAlternateScreen(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.TEE_VERIFY_PROGRESS_ALT === '0' || env.TEE_VERIFY_PROGRESS_ALT === 'off') return false;
  if (env.TERM === 'dumb' && !isCursorInteractiveProgressHost(env)) return false;
  return true;
}

export function shouldUseMachineProgress(env: NodeJS.ProcessEnv, isTty: boolean | undefined): boolean {
  if (env.TEE_VERIFY_PROGRESS === 'off' || env.TEE_VERIFY_PROGRESS === 'plain') return true;
  if (env.CI === 'true' || env.CI === '1') return true;
  if (env.TEE_VERIFY_PROGRESS === 'live') return false;
  if (isCursorInteractiveProgressHost(env)) return false;
  return isTty !== true;
}

export function ttyLiveStartSequence(useAlternateScreen = true): string {
  if (useAlternateScreen) {
    return `${ANSI_ENTER_ALT_SCREEN}${ANSI_HIDE_CURSOR}${ANSI_ERASE_SCREEN}${ANSI_CURSOR_HOME}`;
  }
  return `${ANSI_HIDE_CURSOR}${ANSI_ERASE_SCREEN}${ANSI_CURSOR_HOME}`;
}

export function ttyLiveRefreshPrefix(): string {
  return `${ANSI_CURSOR_HOME}${ANSI_CLEAR_DOWN}`;
}

export function ttyLiveRestoreSequence(useAlternateScreen = true): string {
  return useAlternateScreen ? `${ANSI_SHOW_CURSOR}${ANSI_LEAVE_ALT_SCREEN}` : ANSI_SHOW_CURSOR;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  if (value > 100) return 100;
  return Math.floor(value);
}

function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function formatApproximateRemaining(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 10) return `~${minutes}m`;
  return `~${Math.round(minutes / 5) * 5}m`;
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

function padLabel(label: string, width = LABEL_WIDTH): string {
  return label.length >= width ? label.slice(0, width) : `${label}${' '.repeat(width - label.length)}`;
}

function barBlocks(fraction: number | null, width = BAR_WIDTH): string {
  if (fraction == null) return '░'.repeat(width);
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`;
}

export function renderProgressBar(params: {
  status: TeeProgressStatus;
  ratio?: number | null;
  pulse?: number;
}): string {
  if (params.status === 'passed' || params.status === 'failed') {
    return `[${barBlocks(1)}]`;
  }
  if (params.status === 'pending') {
    return `[${barBlocks(0)}]`;
  }
  if (typeof params.ratio === 'number' && Number.isFinite(params.ratio)) {
    return `[${barBlocks(Math.max(0, Math.min(1, params.ratio)))}]`;
  }
  return `[${barBlocks(null)}]`;
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

export function formatDurationMs(ms: number): string {
  return formatDuration(ms);
}

function effectiveParentStatus(workers: readonly TeeProgressWorkerSnapshot[]): TeeProgressStatus {
  if (workers.length === 0) return 'pending';
  if (workers.some((worker) => worker.status === 'running')) return 'running';
  if (workers.some((worker) => worker.status === 'failed')) return 'failed';
  if (workers.every((worker) => worker.status === 'pending')) return 'pending';
  if (workers.every((worker) => worker.status === 'passed')) return 'passed';
  return 'running';
}

function formatStageClock(
  startedAtMs: number | null,
  endedAtMs: number | null,
  nowMs: number
): string {
  if (startedAtMs === null) return '';
  return formatDuration((endedAtMs ?? nowMs) - startedAtMs);
}

function formatCountedRow(params: {
  indent: string;
  label: string;
  status: TeeProgressStatus;
  ratio: number | null;
  count: string;
  clock: string;
}): string {
  const parts = [
    `${params.indent}${padLabel(params.label)} ${renderProgressBar({
      status: params.status,
      ratio: params.ratio,
    })}`,
    params.count,
    statusLabel(params.status),
    params.clock,
  ].filter((part) => part.length > 0);
  return parts.join(' ');
}

export function renderTeeProgressLines(snapshot: TeeProgressSnapshot): string[] {
  const etaPart =
    snapshot.completed || snapshot.etaMs === null
      ? formatDuration(snapshot.elapsedMs)
      : `${formatDuration(snapshot.elapsedMs)} · ${formatApproximateRemaining(snapshot.etaMs)} remaining`;
  const overallRatio = (snapshot.completed ? 100 : snapshot.percent) / 100;
  const overallSuffix = snapshot.completed ? ` ${statusLabel(snapshot.status)}` : '';
  const lines = [
    `${snapshot.title}${snapshot.subtitle ? ` — ${snapshot.subtitle}` : ''}`,
    '',
    `${padLabel('Overall')} ${renderProgressBar({
      status: snapshot.completed ? snapshot.status : 'running',
      ratio: overallRatio,
    })} ${String(snapshot.completed ? 100 : snapshot.percent).padStart(3, ' ')}%${overallSuffix}   ${etaPart}`,
    '',
  ];
  const parentId = snapshot.workerParentStageId;
  const workers = parentId ? snapshot.workers : [];
  for (const stage of snapshot.stages) {
    const duration = formatStageClock(stage.startedAtMs, stage.endedAtMs, snapshot.nowMs);
    if (parentId === stage.id && workers.length > 0) {
      const parentStatus = snapshot.completed ? snapshot.status : effectiveParentStatus(workers);
      lines.push(`${padLabel(stage.label)} ${statusLabel(parentStatus)}`);
      for (const worker of workers) {
        const ratio = workerRatio(worker);
        const count = formatCount(worker);
        const workerDuration = formatStageClock(worker.startedAtMs, worker.endedAtMs, snapshot.nowMs);
        lines.push(
          formatCountedRow({
            indent: '  ',
            label: worker.label,
            status: worker.status,
            ratio,
            count,
            clock: workerDuration,
          })
        );
        if (worker.status === 'running' && worker.current) {
          lines.push(`    Current: ${worker.current}`);
        }
        for (const failure of (worker.failures ?? []).slice(0, 5)) {
          lines.push(`    FAIL: ${failure}`);
        }
      }
      continue;
    }
    lines.push(
      formatCountedRow({
        indent: '',
        label: stage.label,
        status: stage.status,
        ratio: stage.status === 'running' ? stage.ratio ?? null : null,
        count: '',
        clock: duration,
      })
    );
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
  ci?: boolean;
  useAlternateScreen?: boolean;
  onRestore?: () => void;
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
  const machineSafe = options.ci === true || isTTY !== true;
  const useAlternateScreen = options.useAlternateScreen !== false;
  const startedAt = now();
  let subtitle: string | undefined;
  let currentStageId: string | null = null;
  let workerParentStageId: string | null = null;
  let percent = 0;
  let completed = false;
  let terminalStatus: TeeProgressStatus = 'running';
  let heartbeatCount = 0;
  let etaMs: number | null = null;
  let liveStarted = false;
  let terminalRestored = false;
  let lastPaint = '';
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
    if (
      completedW <= 0 ||
      elapsed < ETA_MIN_ELAPSED_MS ||
      totalWeight <= 0 ||
      completedW / totalWeight < ETA_MIN_FRACTION
    ) {
      etaMs = null;
      return;
    }
    const remaining = totalWeight - completedW;
    if (remaining <= 0) {
      etaMs = null;
      return;
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

  function writeStream(text: string): void {
    stream?.write(text);
  }

  function restoreTerminal(): void {
    if (machineSafe || !liveStarted || terminalRestored) return;
    writeStream(ttyLiveRestoreSequence(useAlternateScreen));
    terminalRestored = true;
    options.onRestore?.();
  }

  function writeOutput(mode: 'full' | 'status' | 'tick' = 'tick'): void {
    if (!stream) return;
    const rendered = `${renderTeeProgressLines(captureSnapshot()).join('\n')}\n`;
    if (machineSafe) {
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
      writeStream(`${line}\n`);
      pushLine(line);
      return;
    }
    if (completed) {
      restoreTerminal();
      writeStream(rendered);
      lastPaint = rendered;
      return;
    }
    if (!liveStarted) {
      writeStream(`${ttyLiveStartSequence(useAlternateScreen)}${rendered}`);
      liveStarted = true;
      lastPaint = rendered;
      return;
    }
    if (mode === 'tick' && rendered === lastPaint) return;
    writeStream(`${ttyLiveRefreshPrefix()}${rendered}`);
    lastPaint = rendered;
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
        writeOutput('tick');
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
    restoreTerminal() {
      notifyDisplayProgress(() => {
        restoreTerminal();
      });
    },
    snapshot() {
      return captureSnapshot();
    },
  };

  return reporter;
}

export function attachLiveProgressTerminalGuards(
  reporter: Pick<TeeProgressReporter, 'restoreTerminal'>
): () => void {
  const restore = (): void => {
    reporter.restoreTerminal();
  };
  const onSigint = (): void => {
    restore();
    process.kill(process.pid, 'SIGINT');
  };
  const onSigterm = (): void => {
    restore();
    process.kill(process.pid, 'SIGTERM');
  };
  process.once('exit', restore);
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  process.once('uncaughtException', restore);
  process.once('unhandledRejection', restore);
  return () => {
    process.removeListener('exit', restore);
    process.removeListener('SIGINT', onSigint);
    process.removeListener('SIGTERM', onSigterm);
    process.removeListener('uncaughtException', restore);
    process.removeListener('unhandledRejection', restore);
    restore();
  };
}

export const TEE_PROGRESS_DEFAULT_HEARTBEAT_MS = DEFAULT_HEARTBEAT_MS;
