import { config } from 'dotenv';
import { resolve } from 'path';
import pg from 'pg';

const { Client } = pg;
config({ path: resolve(process.cwd(), '.env.local') });
const cs = process.env.POSTGRES_URL_NON_POOLING!;
const url = new URL(cs);

async function run() {
  const client = new Client({
    host: url.hostname,
    port: parseInt(url.port) || 5432,
    database: url.pathname.slice(1),
    user: url.username,
    password: url.password,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const { rows } = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='profiles' ORDER BY ordinal_position`);
  console.log('Profiles columns:', rows.map(r => r.column_name));
  await client.end();
}
run();
