import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const [id, ...paths] = process.argv.slice(2);
const safe = /^(?:app|components|lib|hooks|utils|services|tests\/unit)\/[A-Za-z0-9_()/.[\]-]+\.(?:ts|tsx)$/u;
if (!['targeted-tests', 'typecheck', 'lint'].includes(id) || paths.length > 40 ||
    paths.some(path => !safe.test(path) || path.split('/').some(part => part.startsWith('.'))) ||
    (id === 'typecheck' ? paths.length !== 0 : paths.length === 0) ||
    (id === 'targeted-tests' && paths.some(path => !/^tests\/unit\/.*\.test\.tsx?$/u.test(path)))) {
  throw new Error('Invalid locally scoped check');
}
const commands = {
  'targeted-tests': ['node_modules/vitest/vitest.mjs', 'run', ...paths],
  typecheck: ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'],
  lint: ['node_modules/eslint/bin/eslint.js', ...paths],
};
const [script, ...args] = commands[id];
const result = spawnSync(process.execPath, [resolve(script), ...args], {
  cwd: process.cwd(), env: { ...process.env, AVSWORKLOG_TEST_SKIP_DOTENV: '1' },
  stdio: 'inherit', shell: false, windowsHide: true,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 2;
