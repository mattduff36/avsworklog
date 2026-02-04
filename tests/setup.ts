// tests/setup.ts
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local for tests
config({ path: resolve(process.cwd(), '.env.local') });
