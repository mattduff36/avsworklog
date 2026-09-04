#!/usr/bin/env tsx
/**
 * Short visual diagnostic for the Squires TEE live terminal dashboard.
 *
 * Run from the repo root in a Cursor integrated Terminal:
 *   npx tsx scripts/automation/tee-live-progress-demo.ts
 *   npx tsx scripts/automation/tee-live-progress-demo.ts --fail
 *
 * Exercises one live frame, nested stage bars, captured child output, and
 * terminal restore. Presentation only: it does not run finalise, preflight,
 * or the full suite, and it does not change review or release authority.
 */
import { createHumanTeeProgress, runProcessJob } from './tee-parallel-verify';

const FAIL = process.argv.includes('--fail');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function main(): Promise<void> {
  const progress = createHumanTeeProgress({
    title: 'TEE live dashboard demo',
    subtitle: 'demo',
    stages: [
      { id: 'batch', label: 'Verification batch', weight: 70 },
      { id: 'summary', label: 'Summary', weight: 8 },
    ],
  });
  if (!progress) {
    process.stderr.write('live dashboard demo refused: progress is off\n');
    process.exit(2);
  }

  progress.stageStart('batch');
  progress.setWorkers([
    { id: 'typecheck', label: 'Typecheck' },
    { id: 'tests', label: 'Workflow tests' },
  ]);

  progress.workerUpdate('typecheck', 'running');
  await sleep(1_200);
  progress.workerUpdate('typecheck', 'passed');

  const testsStarted = Date.now();
  progress.workerUpdate('tests', 'running', {
    completed: 0,
    total: 2,
    current: 'demo child',
    startedAtMs: testsStarted,
  });
  const pulse = setInterval(() => {
    progress.workerUpdate('tests', 'running', {
      completed: 0,
      total: 2,
      current: 'demo child',
      startedAtMs: testsStarted,
    });
  }, 250);

  let captured;
  try {
    captured = FAIL
      ? await runProcessJob({
          cwd: process.cwd(),
          command: process.execPath,
          args: [
            '-e',
            "setTimeout(() => { process.stderr.write('intentional demo failure\\n'); process.exit(1); }, 1600);",
          ],
        })
      : await runProcessJob({
          cwd: process.cwd(),
          command: process.execPath,
          args: [
            '-e',
            "process.stdout.write('passing child output must stay captured\\n'); setTimeout(() => { process.stdout.write('vitest spam must not leak\\n'); }, 1600);",
          ],
        });
  } finally {
    clearInterval(pulse);
  }

  progress.workerUpdate('tests', captured.status === 'passed' ? 'passed' : 'failed', {
    completed: captured.status === 'passed' ? 2 : 1,
    total: 2,
    current: captured.status === 'passed' ? undefined : 'demo child',
    failures: captured.status === 'passed' ? undefined : ['intentional demo failure'],
    startedAtMs: testsStarted,
    endedAtMs: Date.now(),
  });
  progress.stageFinish('batch', captured.status === 'passed' ? 'passed' : 'failed');

  if (captured.status !== 'passed') {
    progress.stageStart('summary');
    progress.stageFinish('summary', 'failed');
    progress.complete('failed', 'TEE live dashboard demo');
    const diagnostic = [captured.stderr, captured.stdout]
      .filter((chunk) => chunk.trim().length > 0)
      .join('\n')
      .trim();
    if (diagnostic) {
      process.stderr.write(`${diagnostic}\n`);
    }
    process.exit(1);
  }

  progress.stageStart('summary');
  progress.stageFinish('summary', 'passed');
  progress.complete('passed', 'TEE live dashboard demo');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
