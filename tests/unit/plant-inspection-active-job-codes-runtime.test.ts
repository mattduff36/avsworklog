import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { createPlantInspectionJobPglite } from '../db/plant-inspection-job-fields-pglite-harness';

const CUSTOMER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const LIVE_WEAK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const LIVE_THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2';
const LIVE_OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3';
const LIVE_OTHER_THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb4';
const LIVE_VALID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb5';
const LIVE_VALID_THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb6';
const LIVE_UNIQUE_WEAK = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb7';
const LIVE_UNIQUE_THREAD = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb8';
const DRAFT_ONLY = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const DRAFT_THREAD = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const LOST_LATEST = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const LOST_THREAD = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
const PROJECT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
const LEGACY = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
const SITE = '12 High Street, Southwell';

async function expectSqlError(action: Promise<unknown>, code: string) {
  await expect(action).rejects.toThrow(new RegExp(code));
}

describe('plant inspection active job codes PGlite runtime', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await createPlantInspectionJobPglite();
    await pg.exec(`
      INSERT INTO public.customers (id, status, company_name)
      VALUES ('${CUSTOMER}', 'active', 'Example Customer');

      INSERT INTO public.quotes (
        id, quote_thread_id, customer_id, base_quote_reference, quote_reference,
        subject_line, site_address, status, commercial_status, is_latest_version, revision_number
      ) VALUES
        ('${LIVE_WEAK}', '${LIVE_THREAD}', '${CUSTOMER}', '50001-LC', '50001-LC', 'Cable works', 'Yard', 'sent', 'open', TRUE, 0),
        ('${LIVE_OTHER}', '${LIVE_OTHER_THREAD}', '${CUSTOMER}', '50001-LC', '50001-LC', 'Other works', 'Depot', 'sent', 'open', TRUE, 0),
        ('${LIVE_VALID}', '${LIVE_VALID_THREAD}', '${CUSTOMER}', '50002-LC', '50002-LC', 'Valid works', '${SITE}', 'sent', 'open', TRUE, 0),
        ('${LIVE_UNIQUE_WEAK}', '${LIVE_UNIQUE_THREAD}', '${CUSTOMER}', '50009-LC', '50009-LC', 'Unique weak works', 'Yard', 'sent', 'open', TRUE, 0),
        ('${DRAFT_ONLY}', '${DRAFT_THREAD}', '${CUSTOMER}', '50003-LC', '50003-LC', 'Draft only', '${SITE}', 'draft', 'open', TRUE, 0),
        ('${LOST_LATEST}', '${LOST_THREAD}', '${CUSTOMER}', '50004-LC', '50004-LC', 'Lost works', '${SITE}', 'lost', 'open', TRUE, 0);

      INSERT INTO public.quote_project_numbers (id, project_reference, title, site_address, status)
      VALUES ('${PROJECT}', '60010-MD', 'Open project', 'Site', 'open');

      INSERT INTO public.legacy_quotes (id, quote_reference, customer_name, title, site_address)
      VALUES ('${LEGACY}', '4323-GH', 'Example Customer', 'Legacy works', NULL);
    `);
  });

  afterAll(async () => {
    await pg.close();
  });

  it('submits a weak-address live quote and dedupes the action', async () => {
    await pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code, inspection_date)
       VALUES ('submitted', 'live_quote', $1, '50001-LC', '2026-09-25')`,
      [LIVE_WEAK]
    );
    await pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code, inspection_date)
       VALUES ('submitted', 'live_quote', $1, '50001-LC', '2026-09-25')`,
      [LIVE_WEAK]
    );

    const actions = await pg.query<{ dedupe_key: string; title: string }>(
      `SELECT dedupe_key, title FROM public.reminder_actions WHERE metadata->>'job_source_id' = $1`,
      [LIVE_WEAK]
    );
    expect(actions.rows).toHaveLength(1);
    expect(actions.rows[0].dedupe_key).toBe(`plant_legacy_missing_site:live_quote:${LIVE_WEAK}:50001LC`);
    expect(actions.rows[0].title).toBe('Add a site address for job 50001-LC');
  });

  it('submits an open project and a legacy code with weak addresses', async () => {
    await pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code)
       VALUES ('submitted', 'project_number', $1, '60010-MD')`,
      [PROJECT]
    );
    await pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code)
       VALUES ('submitted', 'legacy_quote', $1, '4323-GH')`,
      [LEGACY]
    );

    const actions = await pg.query<{ dedupe_key: string }>(
      `SELECT dedupe_key FROM public.reminder_actions ORDER BY dedupe_key`
    );
    expect(actions.rows.map((row) => row.dedupe_key)).toEqual(expect.arrayContaining([
      `plant_legacy_missing_site:project_number:${PROJECT}:60010MD`,
      `plant_legacy_missing_site:${LEGACY}:4323GH`,
    ]));
  });

  it('does not create an action for a reliable address or a draft', async () => {
    await pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code)
       VALUES ('draft', 'live_quote', $1, '50001-LC')`,
      [LIVE_WEAK]
    );
    await pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code)
       VALUES ('submitted', 'live_quote', $1, '50002-LC')`,
      [LIVE_VALID]
    );

    const actions = await pg.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM public.reminder_actions
       WHERE metadata->>'job_source_id' = ANY($1::text[])`,
      [[LIVE_VALID]]
    );
    expect(actions.rows[0].count).toBe('0');
  });

  it('rejects draft-only, closed, and unknown identities', async () => {
    await expectSqlError(pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code)
       VALUES ('submitted', 'live_quote', $1, '50003-LC')`,
      [DRAFT_ONLY]
    ), 'JOB_NOT_FOUND');
    await expectSqlError(pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code)
       VALUES ('submitted', 'live_quote', $1, '50004-LC')`,
      [LOST_LATEST]
    ), 'JOB_NOT_FOUND');
    await expectSqlError(pg.query(
      `INSERT INTO public.plant_inspections (status, job_source_type, job_source_id, job_code)
       VALUES ('submitted', 'live_quote', '99999999-9999-4999-8999-999999999999', '50001-LC')`
    ), 'JOB_NOT_FOUND');
  });

  it('keeps daily allocation strict for a weak address and an ambiguous code', async () => {
    await expectSqlError(pg.query(
      `SELECT * FROM private.apply_allocation_job_fields('live_quote', $1, '50009-LC', TRUE)`,
      [LIVE_UNIQUE_WEAK]
    ), 'JOB_MISSING_SITE');
    await expectSqlError(pg.query(
      `SELECT * FROM private.apply_allocation_job_fields(NULL, NULL, '50001-LC', TRUE)`
    ), 'JOB_AMBIGUOUS');
  });
});
