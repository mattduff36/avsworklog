import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const files = [
  'tests/ui/hgv-list-pagination.test.tsx',
  'tests/ui/plant-list-pagination.test.tsx',
  'tests/unit/inventory-source-location-hints.test.ts',
  'tests/unit/inventory-list-hints-route.test.ts',
  'tests/unit/maintenance-service-template-enrichment.test.ts',
  'tests/unit/pdf-progressive-pages.test.ts',
  'tests/ui/inventory-retired-lazy-loading.test.tsx',
  'tests/ui/inventory-targeted-refresh.test.tsx',
];
const runner = 'scripts/testing/run-terminal-tests.ts';
for (const file of [...files, runner, 'node_modules/tsx/dist/cli.mjs']) {
  if (!fs.existsSync(path.resolve(file))) {
    console.error(`Missing performance-check prerequisite: ${file}`);
    process.exit(1);
  }
}
const result = spawnSync(process.execPath, [
  path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve(runner),
  '--suite', 'vitest', '--', 'run', ...files,
], { stdio: 'inherit', windowsHide: true });
if (result.error) console.error('Unable to start local performance checks');
process.exit(result.status ?? 1);
