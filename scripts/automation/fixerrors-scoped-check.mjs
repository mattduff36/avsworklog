import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { CACHE_ROOT, WORKSPACE, createTypecheckCache } from './fixerrors-typecheck-cache.mjs';

const [id, ...args] = process.argv.slice(2);
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
      scope.tests.some(name => !scope.paths.includes(name))) throw new Error('Invalid aggregate scope');
  paths = id === 'targeted-tests' ? scope.tests : scope.paths;
}
const safe = /^(?:app|components|lib|hooks|utils|services|tests\/unit)\/[A-Za-z0-9_()/.[\]-]+\.(?:ts|tsx)$/u;
if (!['targeted-tests', 'typecheck', 'lint'].includes(id) || (!aggregate && paths.length > 40) ||
    new Set(paths).size !== paths.length ||
    paths.some(path => typeof path !== 'string' || !safe.test(path) || path.split('/').some(part => part.startsWith('.'))) ||
    (id === 'typecheck' ? paths.length !== 0 : paths.length === 0) ||
    (id === 'targeted-tests' && paths.some(path => !/^tests\/unit\/.*\.test\.tsx?$/u.test(path)))) {
  throw new Error('Invalid locally scoped check');
}
const commands = {
  'targeted-tests': ['node_modules/vitest/vitest.mjs', 'run'],
  lint: ['node_modules/eslint/bin/eslint.js'],
};
if (id === 'typecheck') {
  if (process.cwd() !== WORKSPACE) throw new Error('Typecheck requires fixed checkout');
  process.exitCode = createTypecheckCache(WORKSPACE, CACHE_ROOT).check();
} else {
  const [script, ...fixed] = commands[id];
  // Bound individual command lines, not the total accepted batch scope.
  while (paths.length) {
    const chunk = paths.slice(0, 40);
    paths = paths.slice(chunk.length);
    const result = spawnSync(process.execPath, [resolve(script), ...fixed, ...chunk], {
      cwd: process.cwd(), env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '1', NODE_DISABLE_COMPILE_CACHE: '1' },
      stdio: 'inherit', shell: false, windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) { process.exitCode = result.status ?? 2; break; }
  }
}
