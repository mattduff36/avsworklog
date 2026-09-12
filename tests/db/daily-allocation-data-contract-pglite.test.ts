import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  applyDailyAllocationV2Migration,
  createDailyAllocationV2Pglite,
  enableDailyAllocationV2,
  hashDailyAllocationV1Content,
  withAuthenticatedRole,
} from './daily-allocation-v2-pglite-harness';

const migrationSql = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260912_daily_allocation_idempotent_mutations_and_guided_conversion.sql'
  ),
  'utf8'
);

describe('DAFP migration runtime smoke', () => {
  let pg: PGlite | null = null;

  afterEach(async () => {
    await pg?.close();
    pg = null;
  });

  it('applies after the shipped v2 migration with closed flags and private ledger ACLs', async () => {
    pg = await createDailyAllocationV2Pglite();
    await applyDailyAllocationV2Migration(pg);
    await pg.exec(migrationSql);

    const runtime = await pg.query<{
      board_enabled: boolean;
      writes_enabled: boolean;
    }>(`
      SELECT board_enabled, writes_enabled
      FROM private.daily_allocation_v2_runtime
      WHERE singleton = TRUE
    `);
    expect(runtime.rows).toEqual([
      { board_enabled: false, writes_enabled: false },
    ]);

    const acl = await pg.query<{ authenticated_select: boolean; anon_select: boolean }>(`
      SELECT
        has_table_privilege(
          'authenticated',
          'private.daily_allocation_mutation_requests',
          'SELECT'
        ) AS authenticated_select,
        has_table_privilege(
          'anon',
          'private.daily_allocation_mutation_requests',
          'SELECT'
        ) AS anon_select
    `);
    expect(acl.rows).toEqual([
      { authenticated_select: false, anon_select: false },
    ]);
  }, 30_000);

  it('converts atomically, preserves v1 bytes, and replays the exact stored result', async () => {
    pg = await createDailyAllocationV2Pglite();
    await applyDailyAllocationV2Migration(pg);
    await pg.exec(migrationSql);
    const before = await hashDailyAllocationV1Content(pg);
    await enableDailyAllocationV2(pg);

    let conversionSql = '';
    await withAuthenticatedRole(
      pg,
      '11111111-1111-4111-8111-111111111111',
      async () => {
        const sourceResult = await pg!.query<{ source: { source_fingerprint: string } }>(`
          SELECT public.get_daily_allocation_conversion_source_v2(
            '2026-08-10',
            'team-1'
          ) AS source
        `);
        const fingerprint = sourceResult.rows[0].source.source_fingerprint;
        conversionSql = `
          SELECT public.convert_daily_allocation_plan_day_v2(
            'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            '2026-08-10',
            'team-1',
            '${fingerprint}',
            '[{
              "visit_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              "job_source_type":"project_number",
              "job_source_id":"44444444-4444-4444-8444-444444444444",
              "starts_at":"2026-08-10T08:00:00+01:00",
              "ends_at":"2026-08-10T16:00:00+01:00"
            }]'::jsonb,
            '[{
              "draft_id":"88888888-8888-4888-8888-888888888888",
              "row_version":1,
              "disposition":"visit",
              "visit_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            }]'::jsonb,
            '[{
              "draft_id":"99999999-9999-4999-8999-999999999999",
              "row_version":1,
              "disposition":"visit",
              "visit_id":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
            }]'::jsonb
          ) AS result
        `;
        const first = await pg!.query<{ result: Record<string, unknown> }>(conversionSql);
        const replay = await pg!.query<{ result: Record<string, unknown> }>(conversionSql);
        expect(replay.rows[0].result).toEqual(first.rows[0].result);
        expect(first.rows[0].result).toMatchObject({
          plan_version: 1,
          team_id: 'team-1',
          work_date: '2026-08-10',
          source_fingerprint: fingerprint,
        });
        expect(first.rows[0].result.visits).toHaveLength(1);
        expect(first.rows[0].result.labour_assignments).toHaveLength(1);
        expect(first.rows[0].result.plant_assignments).toHaveLength(1);

        await expect(
          pg!.query(conversionSql.replace(fingerprint, 'f'.repeat(64)))
        ).rejects.toThrow(/REQUEST_ID_REUSED/);

        const assignmentSql = `
          SELECT public.assign_daily_allocation_labour_v2(
            'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            '22222222-2222-4222-8222-222222222222',
            1,
            1,
            NULL,
            NULL,
            'Updated instruction',
            NULL
          ) AS result
        `;
        const assigned = await pg!.query<{
          result: {
            plan_version: number;
            assignment: { row_version: number; notes: string };
          };
        }>(assignmentSql);
        expect(assigned.rows[0].result).toMatchObject({
          plan_version: 2,
          assignment: { row_version: 2, notes: 'Updated instruction' },
        });
        expect((await pg!.query(assignmentSql)).rows[0]).toEqual(assigned.rows[0]);
        await expect(
          pg!.query(assignmentSql
            .replace('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
            .replace(",\n            1,\n            1,", ",\n            2,\n            1,"))
        ).rejects.toThrow(/STALE_ENTITY_VERSION/);
      }
    );

    expect(await hashDailyAllocationV1Content(pg)).toEqual(before);

    await pg.exec(`
      UPDATE private.daily_allocation_v2_runtime
      SET writes_enabled = FALSE
      WHERE singleton = TRUE
    `);
    await withAuthenticatedRole(
      pg,
      '11111111-1111-4111-8111-111111111111',
      async () => {
        await expect(pg!.query(conversionSql)).rejects.toThrow(/V2_DISABLED/);
      }
    );
  }, 30_000);
});
