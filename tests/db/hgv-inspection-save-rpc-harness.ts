import { readFileSync } from 'fs';
import { resolve } from 'path';

export const HGV_SAVE_MIGRATION_PATH = 'supabase/migrations/20260828_hgv_inspection_save_rpc.sql';

export const HGV_SAVE_FIXTURE = {
  actor: '11111111-1111-4111-8111-111111111111',
  manager: '22222222-2222-4222-8222-222222222222',
  subject: '33333333-3333-4333-8333-333333333333',
  hgv: '44444444-4444-4444-8444-444444444444',
  stale: '55555555-5555-4555-8555-555555555555',
  date: '2026-08-21',
} as const;

export function readHgvInspectionSaveFunctionSql(): string {
  const sql = readFileSync(resolve(process.cwd(), HGV_SAVE_MIGRATION_PATH), 'utf8');
  return sql
    .replace(/^-- finalise-phase: predeploy\s*/u, '')
    .replace(/^BEGIN;\s*/u, '')
    .replace(/\s*COMMIT;\s*$/u, '')
    .replace(/REVOKE ALL ON FUNCTION[\s\S]*?FROM PUBLIC;\s*/u, '')
    .replace(/GRANT EXECUTE ON FUNCTION[\s\S]*?TO service_role;\s*/u, '');
}

export function unwrapHgvSaveResult(row: { save_hgv_inspection?: unknown }): { id: string; status?: string } {
  const value = row.save_hgv_inspection;
  if (typeof value === 'string') {
    return JSON.parse(value) as { id: string; status?: string };
  }
  if (value && typeof value === 'object' && 'id' in value) {
    return value as { id: string; status?: string };
  }
  throw new Error('save_hgv_inspection did not return an id');
}

export function hgvInspectionSaveSchemaSql(): string {
  return `
    CREATE EXTENSION IF NOT EXISTS pgcrypto;

    CREATE TABLE IF NOT EXISTS public.hgvs (
      id uuid PRIMARY KEY,
      current_mileage integer
    );

    CREATE TABLE IF NOT EXISTS public.hgv_inspections (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      hgv_id uuid REFERENCES public.hgvs(id),
      user_id uuid NOT NULL,
      inspection_date date NOT NULL,
      inspection_end_date date,
      current_mileage integer,
      status text NOT NULL DEFAULT 'draft',
      submitted_at timestamptz,
      signature_data text,
      signed_at timestamptz,
      inspector_comments text,
      created_at timestamptz DEFAULT now(),
      updated_at timestamptz DEFAULT now()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_hgv_inspection_user_date
      ON public.hgv_inspections (hgv_id, user_id, inspection_date)
      WHERE hgv_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS public.inspection_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      inspection_id uuid NOT NULL,
      item_number integer NOT NULL,
      item_description text,
      status text NOT NULL CHECK (status IN ('ok', 'attention', 'defect', 'na')),
      comments text,
      created_at timestamptz DEFAULT now(),
      day_of_week integer NOT NULL
    );
  `;
}

export function hgvSaveCallSql(status: 'draft' | 'submitted', itemsJson: string, options?: {
  actorId?: string;
  canManageOthers?: boolean;
  subjectUserId?: string;
  hintId?: string | null;
  expectedOwnerId?: string | null;
  mileage?: number | null;
}): string {
  const actorId = options?.actorId ?? HGV_SAVE_FIXTURE.actor;
  const subjectUserId = options?.subjectUserId ?? HGV_SAVE_FIXTURE.actor;
  const hint = options?.hintId === undefined ? 'NULL' : options.hintId === null ? 'NULL' : `'${options.hintId}'::uuid`;
  const expected = options?.expectedOwnerId === undefined
    ? 'NULL'
    : options.expectedOwnerId === null
      ? 'NULL'
      : `'${options.expectedOwnerId}'::uuid`;
  const mileage = options?.mileage === undefined ? 12000 : options.mileage;
  const mileageSql = mileage === null ? 'NULL' : String(mileage);

  return `
    SELECT public.save_hgv_inspection(
      '${actorId}'::uuid,
      ${options?.canManageOthers ?? false},
      '${subjectUserId}'::uuid,
      '${HGV_SAVE_FIXTURE.hgv}'::uuid,
      '${HGV_SAVE_FIXTURE.date}'::date,
      ${hint},
      ${expected},
      '${status}',
      ${mileageSql},
      NULL,
      ${status === 'submitted' ? "'sig'" : 'NULL'},
      '${itemsJson}'::jsonb
    )
  `;
}
