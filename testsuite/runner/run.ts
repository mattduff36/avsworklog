/**
 * run.ts — Testsuite CLI runner
 *
 * Usage:
 *   npx tsx testsuite/runner/run.ts --all
 *   npx tsx testsuite/runner/run.ts --ui
 *   npx tsx testsuite/runner/run.ts --api
 *   npx tsx testsuite/runner/run.ts --tag @fleet
 *   npx tsx testsuite/runner/run.ts --grep "auth"
 */
import { runTerminalTests } from '../../scripts/testing/run-terminal-tests';

const args = process.argv.slice(2);
const runApi = args.includes('--all') || args.includes('--api');
const runUi = args.includes('--all') || args.includes('--ui');
const runAll = !args.includes('--api') && !args.includes('--ui') && !args.includes('--tag') && !args.includes('--grep');

const forwarded: string[] = ['--suite'];
if (runAll || (runApi && runUi)) forwarded.push('testsuite');
else if (runApi) forwarded.push('testsuite-api');
else forwarded.push('testsuite-ui');

const tagIndex = args.indexOf('--tag');
const grepIndex = args.indexOf('--grep');
if (tagIndex >= 0 && args[tagIndex + 1]) forwarded.push('--tag', args[tagIndex + 1]);
if (grepIndex >= 0 && args[grepIndex + 1]) forwarded.push('--grep', args[grepIndex + 1]);

void runTerminalTests(forwarded).then((code) => {
  process.exit(code);
});
