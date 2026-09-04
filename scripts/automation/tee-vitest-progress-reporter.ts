/**
 * Display-only Vitest reporter. Writes suite progress to TEE_VITEST_PROGRESS_FILE.
 * Does not affect JSON ledger output, exit codes, or test results.
 */
import { existsSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';

export const TEE_VITEST_PROGRESS_FILE_ENV = 'TEE_VITEST_PROGRESS_FILE';

export interface TeeVitestProgressSnapshot {
  completed: number;
  total: number | null;
  current: string | null;
  failures: string[];
}

type TaskLike = {
  id?: string;
  type?: string;
  name?: string;
  fullName?: string;
  title?: string;
  tasks?: TaskLike[];
  result?: { state?: string };
  state?: string;
};

function countTasks(task: TaskLike): number {
  if (task.type === 'test' || task.type === 'testcase') return 1;
  const children = Array.isArray(task.tasks) ? task.tasks : [];
  return children.reduce((sum, child) => sum + countTasks(child), 0);
}

function taskIdentity(task: TaskLike): string {
  return String(task.id || task.fullName || task.name || '');
}

function taskName(task: TaskLike): string {
  return String(task.fullName || task.name || task.title || '').trim() || 'test';
}

function taskState(task: TaskLike): string | undefined {
  return task.result?.state ?? task.state;
}

function taskFailed(task: TaskLike): boolean {
  const state = taskState(task);
  return state === 'fail' || state === 'failed';
}

function taskFinished(task: TaskLike): boolean {
  const state = taskState(task);
  return (
    state === 'pass' ||
    state === 'passed' ||
    state === 'fail' ||
    state === 'failed' ||
    state === 'skip' ||
    state === 'skipped' ||
    state === 'todo'
  );
}

export function teeVitestProgressReporterPath(repoRoot: string): string {
  return path
    .join(repoRoot, 'scripts', 'automation', 'tee-vitest-progress-reporter.cjs')
    .replace(/\\/g, '/');
}

export function parseTeeVitestProgressSnapshot(raw: string): TeeVitestProgressSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<TeeVitestProgressSnapshot>;
    if (!parsed || typeof parsed !== 'object') return null;
    const completed = Number(parsed.completed);
    const total =
      parsed.total == null || !Number.isFinite(Number(parsed.total)) ? null : Math.floor(Number(parsed.total));
    return {
      completed: Number.isFinite(completed) ? Math.max(0, Math.floor(completed)) : 0,
      total: total !== null && total < 0 ? null : total,
      current: typeof parsed.current === 'string' ? parsed.current : null,
      failures: Array.isArray(parsed.failures)
        ? parsed.failures.filter((row): row is string => typeof row === 'string')
        : [],
    };
  } catch {
    return null;
  }
}

export function readTeeVitestProgressFile(filePath: string): TeeVitestProgressSnapshot | null {
  try {
    if (!existsSync(filePath)) return null;
    return parseTeeVitestProgressSnapshot(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

export default class TeeVitestProgressReporter {
  private readonly seen = new Set<string>();
  private readonly names = new Map<string, string>();
  private total: number | null = null;
  private completed = 0;
  private current: string | null = null;
  private readonly failures: string[] = [];

  private indexTasks(task: TaskLike): void {
    const id = taskIdentity(task);
    if (id) this.names.set(id, taskName(task));
    for (const child of task.tasks ?? []) this.indexTasks(child);
  }

  private write(): void {
    const file = process.env[TEE_VITEST_PROGRESS_FILE_ENV];
    if (!file) return;
    const snapshot: TeeVitestProgressSnapshot = {
      completed: this.total === null ? this.completed : Math.min(this.completed, this.total),
      total: this.total,
      current: this.current,
      failures: [...this.failures],
    };
    try {
      writeFileSync(file, `${JSON.stringify(snapshot)}\n`, 'utf8');
    } catch {
      /* display-only; never fail the suite */
    }
  }

  private note(id: string, name: string, failed: boolean): void {
    if (!id || this.seen.has(id)) return;
    this.seen.add(id);
    this.completed += 1;
    this.current = name;
    if (failed) this.failures.push(name);
    this.write();
  }

  onCollected(files?: TaskLike[]): void {
    if (!Array.isArray(files)) return;
    for (const file of files) this.indexTasks(file);
    const total = files.reduce((sum, file) => sum + countTasks(file), 0);
    if (total > 0) this.total = total;
    this.write();
  }

  onTaskUpdate(packs?: unknown[]): void {
    if (!Array.isArray(packs)) return;
    for (const pack of packs) {
      const id = Array.isArray(pack) ? String(pack[0] ?? '') : '';
      const task = (Array.isArray(pack) ? pack[1] : pack) as TaskLike | undefined;
      if (!task || typeof task !== 'object') continue;
      const typed: TaskLike = {
        ...task,
        id: task.id || id,
        name: task.name || this.names.get(task.id || id),
      };
      if (typed.type && typed.type !== 'test' && typed.type !== 'testcase') continue;
      const name = taskName(typed) !== 'test' ? taskName(typed) : this.names.get(typed.id || id) || 'test';
      if (!taskFinished(typed)) {
        if (name !== 'test') this.current = name;
        continue;
      }
      this.note(typed.id || id, name, taskFailed(typed));
    }
  }

  onTestCaseResult(testCase?: TaskLike): void {
    if (!testCase) return;
    this.note(taskIdentity(testCase), taskName(testCase), taskFailed(testCase));
  }
}
