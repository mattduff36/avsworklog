import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import {
  JOB_CATALOGUE_IDS as IDS,
  applyJobCatalogueFallbackRollback,
  createJobCatalogueFallbackPglite,
  resolveAllocationJob,
} from './job-catalogue-revision-fallback-pglite-harness';

const SITE = '12 High Street, Southwell';

describe('job catalogue revision fallback PGlite runtime', () => {
  let pg: PGlite;

  beforeAll(async () => {
    pg = await createJobCatalogueFallbackPglite();
    await pg.exec(`
      INSERT INTO public.customers (id, status, company_name) VALUES
        ('${IDS.customerActive}', 'active', 'Omexom'),
        ('${IDS.customerInactive}', 'inactive', 'Inactive Ltd');

      INSERT INTO public.quotes (
        id, quote_thread_id, customer_id, base_quote_reference, quote_reference,
        subject_line, site_address, status, commercial_status, is_latest_version,
        revision_number, created_at
      ) VALUES
        (
          '${IDS.originalGh}', '${IDS.threadGh}', '${IDS.customerActive}',
          '40118-GH', '40118-GH', 'Original works', '${SITE}',
          'po_received', 'open', FALSE, 0, '2026-01-01T10:00:00Z'
        ),
        (
          '${IDS.midSentGh}', '${IDS.threadGh}', '${IDS.customerActive}',
          '40118-GH', '40118-GH-REV1', 'Mid sent', '${SITE}',
          'sent', 'open', FALSE, 1, '2026-02-01T10:00:00Z'
        ),
        (
          '${IDS.draftGh}', '${IDS.threadGh}', '${IDS.customerActive}',
          '40118-GH', '40118-GH-REV2', 'Draft revision', '${SITE}',
          'draft', 'open', TRUE, 2, '2026-03-01T10:00:00Z'
        ),
        (
          '${IDS.draftNever}', '${IDS.threadNever}', '${IDS.customerActive}',
          '40119-GH', '40119-GH', 'Never sent', '${SITE}',
          'draft', 'open', TRUE, 0, '2026-03-01T10:00:00Z'
        ),
        (
          '${IDS.sentLost}', '${IDS.threadLost}', '${IDS.customerActive}',
          '40120-GH', '40120-GH', 'Lost original', '${SITE}',
          'sent', 'open', FALSE, 0, '2026-01-01T10:00:00Z'
        ),
        (
          '${IDS.lostLatest}', '${IDS.threadLost}', '${IDS.customerActive}',
          '40120-GH', '40120-GH-REV1', 'Lost latest', '${SITE}',
          'lost', 'open', TRUE, 1, '2026-03-01T10:00:00Z'
        ),
        (
          '${IDS.sentClosed}', '${IDS.threadClosed}', '${IDS.customerActive}',
          '40121-GH', '40121-GH', 'Closed original', '${SITE}',
          'sent', 'open', FALSE, 0, '2026-01-01T10:00:00Z'
        ),
        (
          '${IDS.closedLatest}', '${IDS.threadClosed}', '${IDS.customerActive}',
          '40121-GH', '40121-GH-REV1', 'Closed latest', '${SITE}',
          'closed', 'open', TRUE, 1, '2026-03-01T10:00:00Z'
        ),
        (
          '${IDS.sentCommercial}', '${IDS.threadCommercial}', '${IDS.customerActive}',
          '40122-GH', '40122-GH', 'Commercial original', '${SITE}',
          'sent', 'open', FALSE, 0, '2026-01-01T10:00:00Z'
        ),
        (
          '${IDS.latestCommercial}', '${IDS.threadCommercial}', '${IDS.customerActive}',
          '40122-GH', '40122-GH-REV1', 'Commercial latest', '${SITE}',
          'draft', 'closed', TRUE, 1, '2026-03-01T10:00:00Z'
        ),
        (
          '${IDS.sentInactive}', '${IDS.threadInactive}', '${IDS.customerInactive}',
          '40123-GH', '40123-GH', 'Inactive original', '${SITE}',
          'sent', 'open', FALSE, 0, '2026-01-01T10:00:00Z'
        ),
        (
          '${IDS.latestInactive}', '${IDS.threadInactive}', '${IDS.customerInactive}',
          '40123-GH', '40123-GH-REV1', 'Inactive latest', '${SITE}',
          'draft', 'open', TRUE, 1, '2026-03-01T10:00:00Z'
        ),
        (
          '${IDS.aliasSourceQuote}', '${IDS.threadAliasSource}', '${IDS.customerActive}',
          '39900-GH', '39900-GH', 'Retired source', '${SITE}',
          'sent', 'open', TRUE, 0, '2026-01-01T10:00:00Z'
        ),
        (
          '${IDS.sentCollisionA}', '${IDS.threadCollisionA}', '${IDS.customerActive}',
          '40130-GH', '40130-GH', 'Collision A', '${SITE}',
          'sent', 'open', TRUE, 0, '2026-01-01T10:00:00Z'
        ),
        (
          '${IDS.sentCollisionB}', '${IDS.threadCollisionB}', '${IDS.customerActive}',
          '40130-GH', '40130-GH', 'Collision B', '${SITE}',
          'sent', 'open', TRUE, 0, '2026-01-01T11:00:00Z'
        );

      INSERT INTO public.quote_reference_aliases (
        alias_reference, source_quote_thread_id, canonical_quote_thread_id
      ) VALUES (
        '39900-GH', '${IDS.threadAliasSource}', '${IDS.threadGh}'
      );
    `);
  }, 30_000);

  afterAll(async () => {
    await pg?.close();
  });

  it('SQL-RUNTIME-001: by-id and by-code return the same representative and any version UUID canonicalizes', async () => {
    const byOriginal = await resolveAllocationJob(pg, 'live_quote', IDS.originalGh, null);
    const byMid = await resolveAllocationJob(pg, 'live_quote', IDS.midSentGh, null);
    const byDraft = await resolveAllocationJob(pg, 'live_quote', IDS.draftGh, null);
    const byCode = await resolveAllocationJob(pg, null, null, '40118-GH');

    expect(byOriginal).toHaveLength(1);
    expect(byMid).toEqual(byOriginal);
    expect(byDraft).toEqual(byOriginal);
    expect(byCode).toEqual(byOriginal);
    expect(byOriginal[0]).toMatchObject({
      source_type: 'live_quote',
      source_id: IDS.midSentGh,
      job_code: '40118-GH',
      title: 'Mid sent',
    });
    expect(byOriginal[0].job_code).not.toContain('REV');
  });

  it('SQL-RUNTIME-002: never-sent and terminal or closed threads return zero rows', async () => {
    expect(await resolveAllocationJob(pg, 'live_quote', IDS.draftNever, null)).toEqual([]);
    expect(await resolveAllocationJob(pg, null, null, '40119-GH')).toEqual([]);
    expect(await resolveAllocationJob(pg, 'live_quote', IDS.lostLatest, null)).toEqual([]);
    expect(await resolveAllocationJob(pg, 'live_quote', IDS.sentLost, null)).toEqual([]);
    expect(await resolveAllocationJob(pg, null, null, '40120-GH')).toEqual([]);
    expect(await resolveAllocationJob(pg, 'live_quote', IDS.closedLatest, null)).toEqual([]);
    expect(await resolveAllocationJob(pg, null, null, '40121-GH')).toEqual([]);
    expect(await resolveAllocationJob(pg, 'live_quote', IDS.latestCommercial, null)).toEqual([]);
    expect(await resolveAllocationJob(pg, null, null, '40122-GH')).toEqual([]);
    expect(await resolveAllocationJob(pg, 'live_quote', IDS.latestInactive, null)).toEqual([]);
    expect(await resolveAllocationJob(pg, null, null, '40123-GH')).toEqual([]);
  });

  it('SQL-RUNTIME-003: aliases deduplicate per canonical thread while unrelated collisions stay ambiguous', async () => {
    const byAliasCode = await resolveAllocationJob(pg, null, null, '39900-GH');
    const byAliasSourceId = await resolveAllocationJob(pg, 'live_quote', IDS.aliasSourceQuote, null);
    const byCanonical = await resolveAllocationJob(pg, 'live_quote', IDS.draftGh, null);

    expect(byAliasCode).toHaveLength(1);
    expect(byAliasSourceId).toEqual(byAliasCode);
    expect(byCanonical).toEqual(byAliasCode);
    expect(byAliasCode[0].source_id).toBe(IDS.midSentGh);

    const collisions = await resolveAllocationJob(pg, null, null, '40130-GH');
    expect(collisions).toHaveLength(2);
    expect(new Set(collisions.map((row) => row.source_id))).toEqual(
      new Set([IDS.sentCollisionA, IDS.sentCollisionB])
    );
  });
});

describe('job catalogue revision fallback rollback', () => {
  it('restores latest-only eligibility and drops the helper', async () => {
    const pg = await createJobCatalogueFallbackPglite();
    try {
      await pg.exec(`
        INSERT INTO public.customers (id, status, company_name)
        VALUES ('${IDS.customerActive}', 'active', 'Omexom');
        INSERT INTO public.quotes (
          id, quote_thread_id, customer_id, base_quote_reference, quote_reference,
          subject_line, site_address, status, commercial_status, is_latest_version,
          revision_number, created_at
        ) VALUES
          (
            '${IDS.originalGh}', '${IDS.threadGh}', '${IDS.customerActive}',
            '40118-GH', '40118-GH', 'Original works', '${SITE}',
            'po_received', 'open', FALSE, 0, '2026-01-01T10:00:00Z'
          ),
          (
            '${IDS.draftGh}', '${IDS.threadGh}', '${IDS.customerActive}',
            '40118-GH', '40118-GH-REV1', 'Draft revision', '${SITE}',
            'draft', 'open', TRUE, 1, '2026-03-01T10:00:00Z'
          );
      `);
      expect(await resolveAllocationJob(pg, null, null, '40118-GH')).toHaveLength(1);
      await applyJobCatalogueFallbackRollback(pg);
      const helper = await pg.query<{ exists: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_proc
           JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
           WHERE pg_namespace.nspname = 'private'
             AND pg_proc.proname = 'allocation_live_quote_thread_representative'
         ) AS exists`
      );
      expect(helper.rows[0]?.exists).toBe(false);
      expect(await resolveAllocationJob(pg, 'live_quote', IDS.draftGh, null)).toEqual([]);
      expect(await resolveAllocationJob(pg, null, null, '40118-GH')).toEqual([]);
    } finally {
      await pg.close();
    }
  });
});
