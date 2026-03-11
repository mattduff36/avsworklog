-- Absence FY updates:
-- 1) Color per absence reason
-- 2) Idempotent bank-holiday generated absences
-- 3) Ensure Unpaid leave exists and active

BEGIN;

ALTER TABLE absence_reasons
ADD COLUMN IF NOT EXISTS color TEXT;

UPDATE absence_reasons
SET color = '#6366f1'
WHERE color IS NULL OR btrim(color) = '';

ALTER TABLE absence_reasons
ALTER COLUMN color SET DEFAULT '#6366f1';

ALTER TABLE absence_reasons
ALTER COLUMN color SET NOT NULL;

ALTER TABLE absences
ADD COLUMN IF NOT EXISTS is_bank_holiday BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS auto_generated BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS generation_source TEXT,
ADD COLUMN IF NOT EXISTS holiday_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_absences_holiday_key_unique
ON absences (holiday_key)
WHERE holiday_key IS NOT NULL;

INSERT INTO absence_reasons (name, is_paid, color, is_active)
VALUES ('Unpaid leave', false, '#64748b', true)
ON CONFLICT (name) DO UPDATE
SET
  is_paid = EXCLUDED.is_paid,
  is_active = true;

UPDATE absence_reasons
SET color = CASE lower(name)
  WHEN 'annual leave' THEN '#8b5cf6'
  WHEN 'unpaid leave' THEN '#64748b'
  WHEN 'sickness' THEN '#ef4444'
  WHEN 'maternity leave' THEN '#ec4899'
  WHEN 'paternity leave' THEN '#3b82f6'
  WHEN 'public duties' THEN '#14b8a6'
  WHEN 'dependant emergency' THEN '#f97316'
  WHEN 'medical appointment' THEN '#06b6d4'
  WHEN 'parental leave' THEN '#10b981'
  WHEN 'bereavement' THEN '#6366f1'
  WHEN 'sabbatical' THEN '#a855f7'
  ELSE color
END
WHERE color IS NULL OR color = '#6366f1';

COMMIT;
