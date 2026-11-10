import { readFileSync } from 'fs';
import { fileURLToPath, pathToFileURL } from 'url';
import { createLocalFixerrorsDbClient } from '../../lib/server/fixerrors/store';

export async function setupFixerrorsLocalSchema(): Promise<void> {
  if (process.env.SQUIRES_FIXERRORS_LOCAL_SCHEMA_APPLY !== '1') throw new Error('Explicit local schema opt-in required');
  const client = createLocalFixerrorsDbClient();
  const sql = readFileSync(fileURLToPath(new URL('./local-migrations/20261109_fixerrors_control.sql', import.meta.url)), 'utf8');
  await client.connect();
  try {
    // Forward-only: an already-installed schema fails rather than replaying or resetting state.
    await client.query(sql);
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  setupFixerrorsLocalSchema().then(() => console.info('Dedicated local Fixerrors schema installed. Production remains disabled.')).catch(() => {
    console.error('Local schema setup failed; inspect local configuration. No production fallback.');
    process.exitCode = 1;
  });
}
