/**
 * Logged audit wrapper for frequently used codebase checks.
 *
 * Usage:
 *   npm run audit:quick
 *   npm run audit:medium
 *   npm run audit:all
 */

import { AutomationRun } from './automation/logger';

type AuditMode = 'quick' | 'medium' | 'full';

interface AuditStep {
  label: string;
  command: string;
  args: string[];
}

const AUDIT_STEPS: Record<AuditMode, AuditStep[]> = {
  quick: [
    { label: 'ESLint', command: 'npm', args: ['run', 'lint'] },
    { label: 'Oxlint', command: 'npm', args: ['run', 'lint:fast'] },
    { label: 'Dependency check', command: 'npm', args: ['run', 'deps:check'] },
  ],
  medium: [
    { label: 'ESLint', command: 'npm', args: ['run', 'lint'] },
    { label: 'Oxlint', command: 'npm', args: ['run', 'lint:fast'] },
    { label: 'Dependency check', command: 'npm', args: ['run', 'deps:check'] },
    { label: 'Production build', command: 'npm', args: ['run', 'build'] },
  ],
  full: [
    { label: 'ESLint', command: 'npm', args: ['run', 'lint'] },
    { label: 'Oxlint', command: 'npm', args: ['run', 'lint:fast'] },
    { label: 'Dependency check', command: 'npm', args: ['run', 'deps:check'] },
    { label: 'Bundle-analyzed build', command: 'npm', args: ['run', 'build:analyze'] },
    { label: 'Link check', command: 'npm', args: ['run', 'test:links'] },
    { label: 'Lighthouse CI', command: 'npm', args: ['run', 'test:lighthouse'] },
  ],
};

function parseMode(args: string[]): AuditMode {
  if (args.includes('--quick')) return 'quick';
  if (args.includes('--medium')) return 'medium';
  if (args.includes('--full')) return 'full';
  return 'full';
}

async function main(): Promise<number> {
  const mode = parseMode(process.argv.slice(2));
  const run = new AutomationRun({
    scriptName: `audit-${mode}`,
    mode,
    args: process.argv.slice(2),
  });

  try {
    console.log(`Starting logged ${mode} audit...`);
    for (const step of AUDIT_STEPS[mode]) {
      console.log(`\n==> ${step.label}`);
      run.runCommand(step.command, step.args);
    }

    console.log(`\n${mode} audit complete.`);
    run.finish('passed');
    return 0;
  } catch (error) {
    run.finish('failed', error);
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}

main().then((exitCode) => process.exit(exitCode));
