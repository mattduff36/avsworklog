BEGIN;

ALTER TABLE org_teams
  ADD COLUMN IF NOT EXISTS timesheet_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'org_teams_timesheet_type_check'
  ) THEN
    ALTER TABLE org_teams
      ADD CONSTRAINT org_teams_timesheet_type_check
      CHECK (timesheet_type IN ('civils', 'plant'));
  END IF;
END $$;

UPDATE org_teams
SET timesheet_type = CASE
  WHEN LOWER(id) = 'plant' OR LOWER(name) = 'plant' THEN 'plant'
  ELSE 'civils'
END
WHERE timesheet_type IS NULL;

ALTER TABLE org_teams
  ALTER COLUMN timesheet_type SET DEFAULT 'civils';

COMMENT ON COLUMN org_teams.timesheet_type IS
  'Specifies which timesheet format this team uses (civils, plant, etc.)';

CREATE INDEX IF NOT EXISTS idx_org_teams_timesheet_type
  ON org_teams(timesheet_type);

COMMIT;
