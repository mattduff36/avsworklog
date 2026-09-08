// tests/setup.ts
import { vi } from 'vitest';
import { config } from 'dotenv';
import { resolve } from 'path';

vi.mock('server-only', () => ({}));

// Disposable database runners provide a complete child-only environment.
// Reloading .env.local there could reintroduce a remote database URL.
if (process.env.AVSWORKLOG_TEST_SKIP_DOTENV !== '1') {
  config({ path: resolve(process.cwd(), '.env.local') });
}
