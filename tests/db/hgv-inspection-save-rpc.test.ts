import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  DATABASE_COMMENT_PREFIX,
  PROJECT_NAME_HASH_LENGTH,
  PROJECT_NAME_PREFIX,
  PROVENANCE_ENV_KEYS,
  STATE_VERSION,
  validateLocalTestDatabaseUrl,
} from '../../scripts/local-test-postgres';
import {
  HGV_SAVE_FIXTURE,
  hgvInspectionSaveSchemaSql,
  hgvSaveCallSql,
  readHgvInspectionSaveFunctionSql,
  unwrapHgvSaveResult,
} from './hgv-inspection-save-rpc-harness';

const describeConcurrency = process.env.TEST_DATABASE_URL ? describe : describe.skip;

const draftItems = JSON.stringify([
  { item_number: 1, item_description: 'Lights', day_of_week: 5, status: 'ok', comments: 'draft' },
]);
const submitItems = JSON.stringify([
  { item_number: 1, item_description: 'Lights', day_of_week: 5, status: 'attention', comments: 'submit' },
  { item_number: 2, item_description: 'Brakes', day_of_week: 5, status: 'ok', comments: null },
]);

describeConcurrency('HGV inspection save RPC disposable PostgreSQL', () => {
  const connectionString = process.env.TEST_DATABASE_URL || '';
  const clients: Client[] = [];
  let setupClient: Client;
  let firstClient: Client;
  let secondClient: Client;

  function requireRunnerProvenance(): { hostPort: number } {
    const marker = process.env[PROVENANCE_ENV_KEYS.marker];
    const projectName = process.env[PROVENANCE_ENV_KEYS.project];
    const portText = process.env[PROVENANCE_ENV_KEYS.port];
    if (!marker || !projectName || !portText || !/^[0-9]+$/u.test(portText)) {
      throw new Error('LTDB-SAFE-001: disposable local PostgreSQL runner provenance is required');
    }

    const hostPort = Number.parseInt(portText, 10);
    validateLocalTestDatabaseUrl(connectionString, hostPort);

    const markerPattern = new RegExp(
      `^${DATABASE_COMMENT_PREFIX}:v${STATE_VERSION}:([0-9a-f]{64}):([0-9a-f]{64})$`,
      'u'
    );
    const markerMatch = markerPattern.exec(marker);
    if (
      !markerMatch ||
      projectName !==
        `${PROJECT_NAME_PREFIX}${markerMatch[1].slice(0, PROJECT_NAME_HASH_LENGTH)}`
    ) {
      throw new Error('LTDB-SAFE-001: runner project and database marker provenance disagree');
    }

    return { hostPort };
  }

  async function connectClient(): Promise<Client> {
    const client = new Client({ connectionString, ssl: false });
    await client.connect();
    clients.push(client);
    return client;
  }

  beforeAll(async () => {
    requireRunnerProvenance();
    setupClient = await connectClient();
    firstClient = await connectClient();
    secondClient = await connectClient();
    await setupClient.query(hgvInspectionSaveSchemaSql());
    await setupClient.query(readHgvInspectionSaveFunctionSql());
    await setupClient.query('INSERT INTO public.hgvs (id, current_mileage) VALUES ($1, 10000)', [
      HGV_SAVE_FIXTURE.hgv,
    ]);
    await firstClient.query(`SET lock_timeout = '8s'`);
    await secondClient.query(`SET lock_timeout = '8s'`);
    await firstClient.query(`SET statement_timeout = '10s'`);
    await secondClient.query(`SET statement_timeout = '10s'`);
  });

  afterAll(async () => {
    for (const client of clients) {
      await client.end().catch(() => undefined);
    }
  });

  it('HGV-SAVE-CONC-01 concurrent draft and submit leave one complete submitted item set', async () => {
    await firstClient.query('BEGIN');
    const draft = await firstClient.query<{ save_hgv_inspection: unknown }>(
      hgvSaveCallSql('draft', draftItems, { expectedOwnerId: null })
    );
    const inspectionId = unwrapHgvSaveResult(draft.rows[0]).id;

    const submitPromise = secondClient.query<{ save_hgv_inspection: unknown }>(
      hgvSaveCallSql('submitted', submitItems, { expectedOwnerId: HGV_SAVE_FIXTURE.actor, mileage: 13000 })
    );

    await firstClient.query('COMMIT');
    const submitted = unwrapHgvSaveResult((await submitPromise).rows[0]);

    expect(submitted.id).toBe(inspectionId);
    expect(submitted.status).toBe('submitted');

    const items = await setupClient.query<{ item_number: number; status: string; comments: string | null }>(
      `SELECT item_number, status, comments
       FROM public.inspection_items
       WHERE inspection_id = $1
       ORDER BY item_number`,
      [inspectionId]
    );

    expect(items.rows).toEqual([
      { item_number: 1, status: 'attention', comments: 'submit' },
      { item_number: 2, status: 'ok', comments: null },
    ]);

    const parent = await setupClient.query<{ status: string; current_mileage: number }>(
      'SELECT status, current_mileage FROM public.hgv_inspections WHERE id = $1',
      [inspectionId]
    );
    expect(parent.rows[0]).toEqual({ status: 'submitted', current_mileage: 13000 });
  });
});
