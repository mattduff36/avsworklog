import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/server/inspection-route-access', () => ({
  getInspectionRouteActorAccess: vi.fn(),
}));

vi.mock('@/lib/server/hgv-inspection-save', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/hgv-inspection-save')>();
  return {
    ...actual,
    saveHgvInspectionForActor: vi.fn(actual.saveHgvInspectionForActor),
  };
});

import { getInspectionRouteActorAccess } from '@/lib/server/inspection-route-access';
import {
  authorizeHgvInspectionWrite,
  HgvInspectionSaveBodySchema,
  saveHgvInspectionForActor,
} from '@/lib/server/hgv-inspection-save';
import { POST as saveHgvInspectionPost } from '@/app/api/hgv-inspections/save/route';
import {
  HGV_SAVE_FIXTURE,
  hgvInspectionSaveSchemaSql,
  hgvSaveCallSql,
  readHgvInspectionSaveFunctionSql,
  unwrapHgvSaveResult,
} from '../db/hgv-inspection-save-rpc-harness';

const validItems = JSON.stringify([
  {
    item_number: 1,
    item_description: 'Lights',
    day_of_week: 5,
    status: 'ok',
    comments: null,
  },
]);

const invalidItems = JSON.stringify([
  {
    item_number: 1,
    item_description: 'Lights',
    day_of_week: 5,
    status: 'bogus',
    comments: null,
  },
]);

const validSaveBody = {
  hgvId: HGV_SAVE_FIXTURE.hgv,
  userId: HGV_SAVE_FIXTURE.actor,
  inspectionDate: HGV_SAVE_FIXTURE.date,
  currentMileage: 1,
  status: 'draft' as const,
  inspectorComments: null,
  items: [] as Array<{
    item_number: number;
    item_description: string;
    day_of_week: number;
    status: 'ok' | 'attention' | 'defect' | 'na';
    comments: string | null;
  }>,
};

function saveRequest(body: unknown = validSaveBody): NextRequest {
  return new NextRequest('http://localhost/api/hgv-inspections/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('HGV inspection save coordination', () => {
  let pg: PGlite | undefined;

  beforeEach(() => {
    vi.mocked(getInspectionRouteActorAccess).mockReset();
    vi.mocked(saveHgvInspectionForActor).mockReset();
  });

  afterEach(async () => {
    await pg?.close();
    pg = undefined;
  });

  async function startDb(): Promise<PGlite> {
    pg = new PGlite({ extensions: { pgcrypto } });
    await pg.exec(hgvInspectionSaveSchemaSql());
    await pg.exec(readHgvInspectionSaveFunctionSql());
    await pg.query('INSERT INTO public.hgvs (id, current_mileage) VALUES ($1, 10000)', [HGV_SAVE_FIXTURE.hgv]);
    return pg;
  }

  it('does not delete existing items when replacement fails', async () => {
    const db = await startDb();
    const created = await db.query<{ save_hgv_inspection: unknown }>(
      hgvSaveCallSql('draft', validItems, { expectedOwnerId: null })
    );
    const inspectionId = unwrapHgvSaveResult(created.rows[0]).id;

    await expect(
      db.query(hgvSaveCallSql('draft', invalidItems, { expectedOwnerId: HGV_SAVE_FIXTURE.actor }))
    ).rejects.toThrow(/HGV_SAVE:INVALID_ITEM/);

    const items = await db.query<{ item_number: number; status: string }>(
      'SELECT item_number, status FROM public.inspection_items WHERE inspection_id = $1',
      [inspectionId]
    );
    expect(items.rows).toEqual([{ item_number: 1, status: 'ok' }]);

    await db.exec(`
      CREATE OR REPLACE FUNCTION public.hgv_save_fail_replace()
      RETURNS trigger
      LANGUAGE plpgsql
      AS $fn$
      BEGIN
        IF current_setting('hgv_save.fail_replace', true) = 'on' THEN
          RAISE EXCEPTION 'forced replacement failure';
        END IF;
        RETURN NEW;
      END;
      $fn$;

      DROP TRIGGER IF EXISTS hgv_save_fail_replace ON public.inspection_items;
      CREATE TRIGGER hgv_save_fail_replace
      BEFORE INSERT OR UPDATE ON public.inspection_items
      FOR EACH ROW
      EXECUTE FUNCTION public.hgv_save_fail_replace();
    `);
    await db.exec(`SELECT set_config('hgv_save.fail_replace', 'on', false)`);

    const replacementItems = JSON.stringify([
      {
        item_number: 1,
        item_description: 'Lights',
        day_of_week: 5,
        status: 'attention',
        comments: 'replaced',
      },
    ]);
    await expect(
      db.query(hgvSaveCallSql('draft', replacementItems, { expectedOwnerId: HGV_SAVE_FIXTURE.actor }))
    ).rejects.toThrow(/forced replacement failure/);

    const itemsAfterReplaceFailure = await db.query<{ item_number: number; status: string; comments: string | null }>(
      'SELECT item_number, status, comments FROM public.inspection_items WHERE inspection_id = $1',
      [inspectionId]
    );
    expect(itemsAfterReplaceFailure.rows).toEqual([{ item_number: 1, status: 'ok', comments: null }]);
  });

  it('recovers a stale draft id without writing items to a missing draft', async () => {
    const db = await startDb();
    const saved = await db.query<{ save_hgv_inspection: unknown }>(
      hgvSaveCallSql('draft', validItems, {
        hintId: HGV_SAVE_FIXTURE.stale,
        expectedOwnerId: null,
      })
    );
    const recoveredId = unwrapHgvSaveResult(saved.rows[0]).id;

    expect(recoveredId).not.toBe(HGV_SAVE_FIXTURE.stale);

    const staleItems = await db.query(
      'SELECT id FROM public.inspection_items WHERE inspection_id = $1',
      [HGV_SAVE_FIXTURE.stale]
    );
    expect(staleItems.rows).toHaveLength(0);

    const recoveredItems = await db.query(
      'SELECT id FROM public.inspection_items WHERE inspection_id = $1',
      [recoveredId]
    );
    expect(recoveredItems.rows).toHaveLength(1);

    await expect(
      db.query(
        hgvSaveCallSql('draft', validItems, {
          expectedOwnerId: HGV_SAVE_FIXTURE.manager,
        })
      )
    ).rejects.toThrow(/HGV_SAVE:OWNERSHIP_CHANGED/);
  });

  it('uses the authenticated save boundary for inspection items', async () => {
    const page = readFileSync(
      resolve(process.cwd(), 'app/(dashboard)/hgv-inspections/new/page.tsx'),
      'utf8'
    );
    const client = readFileSync(
      resolve(process.cwd(), 'lib/client/hgv-inspection-save.ts'),
      'utf8'
    );
    const route = readFileSync(
      resolve(process.cwd(), 'app/api/hgv-inspections/save/route.ts'),
      'utf8'
    );

    expect(page).toContain('requestHgvInspectionSave');
    expect(client).toContain('/api/hgv-inspections/save');
    expect(page).not.toMatch(/from\('inspection_items'\)[\s\S]{0,120}\.(insert|delete)\(/u);
    expect(route).toContain("getInspectionRouteActorAccess('hgv-inspections')");
    expect(route).toContain('status: 401');

    expect(
      authorizeHgvInspectionWrite({
        actorId: HGV_SAVE_FIXTURE.actor,
        canManageOthers: false,
        existingOwnerId: HGV_SAVE_FIXTURE.actor,
        subjectUserId: HGV_SAVE_FIXTURE.actor,
      })
    ).toEqual({ ok: true });

    expect(
      authorizeHgvInspectionWrite({
        actorId: HGV_SAVE_FIXTURE.actor,
        canManageOthers: false,
        existingOwnerId: HGV_SAVE_FIXTURE.subject,
        subjectUserId: HGV_SAVE_FIXTURE.subject,
      }).ok
    ).toBe(false);

    expect(
      authorizeHgvInspectionWrite({
        actorId: HGV_SAVE_FIXTURE.manager,
        canManageOthers: true,
        existingOwnerId: HGV_SAVE_FIXTURE.subject,
        subjectUserId: HGV_SAVE_FIXTURE.subject,
      })
    ).toEqual({ ok: true });

    expect(
      HgvInspectionSaveBodySchema.safeParse({
        hgvId: HGV_SAVE_FIXTURE.hgv,
        userId: HGV_SAVE_FIXTURE.actor,
        inspectionDate: HGV_SAVE_FIXTURE.date,
        currentMileage: 1,
        status: 'draft',
        inspectorComments: null,
        items: [],
        canManageOthers: true,
      }).success
    ).toBe(false);

    vi.mocked(getInspectionRouteActorAccess).mockResolvedValue({
      access: null,
      errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const unauthenticated = await saveHgvInspectionPost(saveRequest());
    expect(unauthenticated.status).toBe(401);

    vi.mocked(getInspectionRouteActorAccess).mockResolvedValue({
      access: { userId: HGV_SAVE_FIXTURE.actor, canManageOthers: false, canDeleteInspections: false },
      errorResponse: null,
    });
    vi.mocked(saveHgvInspectionForActor).mockResolvedValue({
      id: HGV_SAVE_FIXTURE.hgv,
      status: 'draft',
      items: [],
    });
    const ownUser = await saveHgvInspectionPost(saveRequest());
    expect(ownUser.status).toBe(200);
    expect(vi.mocked(saveHgvInspectionForActor)).toHaveBeenCalledWith({
      actorId: HGV_SAVE_FIXTURE.actor,
      canManageOthers: false,
      body: validSaveBody,
    });

    const forbiddenError = new Error('Forbidden: cannot save for another user') as Error & {
      status: number;
      code: string;
    };
    forbiddenError.status = 403;
    forbiddenError.code = 'FORBIDDEN';
    vi.mocked(saveHgvInspectionForActor).mockRejectedValueOnce(forbiddenError);
    const forbidden = await saveHgvInspectionPost(
      saveRequest({ ...validSaveBody, userId: HGV_SAVE_FIXTURE.subject })
    );
    expect(forbidden.status).toBe(403);

    vi.mocked(getInspectionRouteActorAccess).mockResolvedValue({
      access: { userId: HGV_SAVE_FIXTURE.manager, canManageOthers: true, canDeleteInspections: true },
      errorResponse: null,
    });
    vi.mocked(saveHgvInspectionForActor).mockResolvedValue({
      id: HGV_SAVE_FIXTURE.hgv,
      status: 'draft',
      items: [],
    });
    const manager = await saveHgvInspectionPost(
      saveRequest({ ...validSaveBody, userId: HGV_SAVE_FIXTURE.subject })
    );
    expect(manager.status).toBe(200);
    expect(vi.mocked(saveHgvInspectionForActor)).toHaveBeenCalledWith({
      actorId: HGV_SAVE_FIXTURE.manager,
      canManageOthers: true,
      body: { ...validSaveBody, userId: HGV_SAVE_FIXTURE.subject },
    });
  });
});
