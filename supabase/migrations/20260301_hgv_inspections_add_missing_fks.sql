-- Fix hgv_inspections FKs: repoint user_id and reviewed_by to profiles (not auth.users)
-- to match plant_inspections / van_inspections and allow PostgREST joins.

BEGIN;

ALTER TABLE hgv_inspections
  DROP CONSTRAINT IF EXISTS hgv_inspections_user_id_fkey;

ALTER TABLE hgv_inspections
  ADD CONSTRAINT hgv_inspections_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id);

ALTER TABLE hgv_inspections
  DROP CONSTRAINT IF EXISTS hgv_inspections_reviewed_by_fkey;

ALTER TABLE hgv_inspections
  ADD CONSTRAINT hgv_inspections_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES profiles(id);

COMMIT;
