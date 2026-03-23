BEGIN;

ALTER TABLE org_teams
  ADD COLUMN IF NOT EXISTS manager_1_profile_id UUID,
  ADD COLUMN IF NOT EXISTS manager_2_profile_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_teams_manager_1_profile_id_fkey'
  ) THEN
    ALTER TABLE org_teams
      ADD CONSTRAINT org_teams_manager_1_profile_id_fkey
      FOREIGN KEY (manager_1_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_teams_manager_2_profile_id_fkey'
  ) THEN
    ALTER TABLE org_teams
      ADD CONSTRAINT org_teams_manager_2_profile_id_fkey
      FOREIGN KEY (manager_2_profile_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'org_teams_manager_slots_distinct_check'
  ) THEN
    ALTER TABLE org_teams
      ADD CONSTRAINT org_teams_manager_slots_distinct_check
      CHECK (
        manager_1_profile_id IS NULL
        OR manager_2_profile_id IS NULL
        OR manager_1_profile_id <> manager_2_profile_id
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_teams_manager_1_profile_id ON org_teams(manager_1_profile_id);
CREATE INDEX IF NOT EXISTS idx_org_teams_manager_2_profile_id ON org_teams(manager_2_profile_id);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_placeholder BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS placeholder_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_placeholder_key
  ON profiles(placeholder_key)
  WHERE placeholder_key IS NOT NULL;

COMMIT;
