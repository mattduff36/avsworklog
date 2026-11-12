import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CACHE_ROOT, WORKSPACE, createTypecheckCache } from './fixerrors-typecheck-cache.mjs';

const [id, ...args] = process.argv.slice(2);
const catalogue = JSON.parse(readFileSync(new URL('../../lib/config/fixerrors-analysis-checks.json', import.meta.url), 'utf8'));
const offlineTests = new Set(catalogue.flatMap(entry => entry.tests));
const observing = id === 'observe-tests';
const testing = observing || id === 'targeted-tests';
let paths = args;
const aggregate = args[0] === '--aggregate';
if (aggregate) {
  if (!['targeted-tests', 'lint'].includes(id) || args.length !== 2 || !/^[a-f0-9]{64}$/u.test(args[1])) {
    throw new Error('Invalid aggregate scope reference');
  }
  const file = resolve('.git', 'squires-fixerrors', 'batch-check-scope.json');
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(file) !== file ||
      stat.size > 16 * 1024 * 1024) throw new Error('Invalid aggregate scope file');
  const bytes = readFileSync(file);
  if (createHash('sha256').update(bytes).digest('hex') !== args[1]) throw new Error('Aggregate scope changed');
  const scope = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(Object.keys(scope)) !== JSON.stringify(['version', 'tests', 'paths']) ||
      scope.version !== 1 || !Array.isArray(scope.tests) || !Array.isArray(scope.paths) ||
      scope.tests.some(name => !scope.paths.includes(name) && !offlineTests.has(name))) throw new Error('Invalid aggregate scope');
  paths = id === 'targeted-tests' ? scope.tests : scope.paths;
}
const safe = /^(?:app|components|lib|hooks|utils|services|tests\/unit)\/[A-Za-z0-9_()/.[\]-]+\.(?:ts|tsx)$/u;
if (!['observe-tests', 'targeted-tests', 'typecheck', 'lint'].includes(id) || (!aggregate && paths.length > 40) ||
    new Set(paths).size !== paths.length ||
    paths.some(path => typeof path !== 'string' ||
      !(safe.test(path) || (testing && offlineTests.has(path))) ||
      path.split('/').some(part => part.startsWith('.'))) ||
    (id === 'typecheck' ? paths.length !== 0 : paths.length === 0) ||
    (testing && paths.some(path => !/^tests\/unit\/.*\.test\.tsx?$/u.test(path) && !offlineTests.has(path)))) {
  throw new Error('Invalid locally scoped check');
}
const commands = {
  'targeted-tests': ['node_modules/vitest/vitest.mjs', 'run'],
  lint: ['node_modules/eslint/bin/eslint.js'],
};
const childOptions = {
  cwd: process.cwd(), env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '1', NODE_DISABLE_COMPILE_CACHE: '1' },
  stdio: 'inherit', shell: false, windowsHide: true,
};

function observe(tests) {
  const directory = mkdtempSync(join(tmpdir(), 'squires-fixerrors-observation-'));
  try {
    const reportPath = join(directory, 'result.json');
    const reporter = fileURLToPath(new URL('./fixerrors-observation-reporter.mjs', import.meta.url));
    const run = spawnSync(process.execPath, [
      resolve('node_modules/vitest/vitest.mjs'), 'run', '--reporter', reporter, ...tests,
    ], { ...childOptions, env: { ...childOptions.env, SQUIRES_FIXERRORS_OBSERVATION: reportPath } });
    if (run.error) throw run.error;
    if (![0, 1].includes(run.status)) throw new Error('Baseline test process did not complete');
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const selected = report.files.map(file => file.path).sort();
    if (!report.complete || JSON.stringify(selected) !== JSON.stringify([...tests].sort()) ||
        report.files.some(file => !file.complete)) throw new Error('Incomplete baseline test run');
    const failed = report.files.flatMap(file => file.failed);
    if ((run.status === 1) !== Boolean(failed.length)) throw new Error('Baseline exit status does not match assertions');
    const passed = report.files.reduce((sum, file) => sum + file.passed, 0);
    console.log(`Baseline observations: ${passed} passed, ${failed.length} failed.`);
    for (const name of failed) console.log('FAILED:', name);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// Run the trusted policy against the real worktree before loading candidate
// code in Vitest, ESLint or TypeScript. The ordinary analysis tree is clean.
const policyScript = fileURLToPath(new URL('./fixerrors-client-recovery.ts', import.meta.url));
const policy = spawnSync(process.execPath, ['--import=tsx', policyScript, '--verify-worktree'], childOptions);
if (policy.error) throw policy.error;
if (policy.status !== 0) throw new Error('Candidate client change requires review before checks');

if (id === 'typecheck') {
  if (process.cwd() !== WORKSPACE) throw new Error('Typecheck requires fixed checkout');
  process.exitCode = createTypecheckCache(WORKSPACE, CACHE_ROOT).check();
} else if (observing) {
  observe(paths);
} else {
  const [script, ...fixed] = commands[id];
  // Bound individual command lines, not the total accepted batch scope.
  while (paths.length) {
    const chunk = paths.slice(0, 40);
    paths = paths.slice(chunk.length);
    const result = spawnSync(process.execPath, [resolve(script), ...fixed, ...chunk], childOptions);
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 2; break; }
  }
}
