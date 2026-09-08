#!/usr/bin/env tsx

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripInheritedDatabaseAndProvenanceEnv } from './local-test-postgres';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(repoRoot, 'package.json'));
const playwrightPackage = require.resolve('@playwright/test/package.json');
const playwrightCli = path.join(path.dirname(playwrightPackage), 'cli.js');
const env = stripInheritedDatabaseAndProvenanceEnv(process.env);

env.AVS_BANK_HOLIDAY_E2E_TOKEN = randomBytes(32).toString('hex');
env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:9';
env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'local-e2e-only';

const child = spawn(
  process.execPath,
  [playwrightCli, 'test', '--config=playwright.bank-holiday.config.ts'],
  {
    cwd: repoRoot,
    env,
    shell: false,
    stdio: 'inherit',
    windowsHide: true,
  }
);

child.once('error', (error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
child.once('exit', (code) => {
  process.exit(code ?? 1);
});
