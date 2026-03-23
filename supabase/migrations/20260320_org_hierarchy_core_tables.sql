BEGIN;

-- ============================================================================
-- ORG HIERARCHY CORE TABLES (HYBRID MODEL)
-- ============================================================================

CREATE TABLE IF NOT EXISTS org_teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  code TEXT UNIQUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS team_id TEXT,
  ADD COLUMN IF NOT EXISTS line_manager_id UUID,
  ADD COLUMN IF NOT EXISTS secondary_manager_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_team_id_fkey'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_team_id_fkey
      FOREIGN KEY (team_id) REFERENCES org_teams(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_line_manager_id_fkey'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_line_manager_id_fkey
      FOREIGN KEY (line_manager_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_secondary_manager_id_fkey'
  ) THEN
    ALTER TABLE profiles
      ADD CONSTRAINT profiles_secondary_manager_id_fkey
      FOREIGN KEY (secondary_manager_id) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_profiles_team_id ON profiles(team_id);
CREATE INDEX IF NOT EXISTS idx_profiles_line_manager_id ON profiles(line_manager_id);
CREATE INDEX IF NOT EXISTS idx_profiles_secondary_manager_id ON profiles(secondary_manager_id);

CREATE TABLE IF NOT EXISTS profile_team_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  team_id TEXT NOT NULL REFERENCES org_teams(id) ON DELETE CASCADE,
  is_primary BOOLEAN NOT NULL DEFAULT TRUE,
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profile_team_memberships_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_profile_team_memberships_profile_id ON profile_team_memberships(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_team_memberships_team_id ON profile_team_memberships(team_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_team_memberships_primary_active
  ON profile_team_memberships(profile_id)
  WHERE is_primary = TRUE AND valid_to IS NULL;

CREATE TABLE IF NOT EXISTS profile_reporting_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  manager_profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL DEFAULT 'primary',
  valid_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  valid_to TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT profile_reporting_lines_no_self_manager CHECK (profile_id <> manager_profile_id),
  CONSTRAINT profile_reporting_lines_relation_type_check CHECK (relation_type IN ('primary', 'secondary', 'line_manager')),
  CONSTRAINT profile_reporting_lines_valid_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE INDEX IF NOT EXISTS idx_profile_reporting_lines_profile_id ON profile_reporting_lines(profile_id);
CREATE INDEX IF NOT EXISTS idx_profile_reporting_lines_manager_profile_id ON profile_reporting_lines(manager_profile_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_profile_reporting_lines_unique_active_relation
  ON profile_reporting_lines(profile_id, manager_profile_id, relation_type)
  WHERE valid_to IS NULL;

CREATE TABLE IF NOT EXISTS org_team_feature_modes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id TEXT NOT NULL REFERENCES org_teams(id) ON DELETE CASCADE,
  workflow_name TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'legacy',
  effective_from TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT org_team_feature_modes_mode_check CHECK (mode IN ('legacy', 'org_v2')),
  CONSTRAINT org_team_feature_modes_workflow_check CHECK (workflow_name IN ('absence_leave')),
  CONSTRAINT org_team_feature_modes_unique UNIQUE (team_id, workflow_name)
);

CREATE INDEX IF NOT EXISTS idx_org_team_feature_modes_team_id ON org_team_feature_modes(team_id);
CREATE INDEX IF NOT EXISTS idx_org_team_feature_modes_workflow ON org_team_feature_modes(workflow_name, mode);

CREATE TABLE IF NOT EXISTS org_hierarchy_change_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_type TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  entity_id TEXT,
  before_json JSONB,
  after_json JSONB,
  changed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_org_hierarchy_change_log_entity ON org_hierarchy_change_log(entity_name, entity_id);
CREATE INDEX IF NOT EXISTS idx_org_hierarchy_change_log_changed_at ON org_hierarchy_change_log(changed_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_org_teams ON org_teams;
CREATE TRIGGER set_updated_at_org_teams
  BEFORE UPDATE ON org_teams
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_profile_team_memberships ON profile_team_memberships;
CREATE TRIGGER set_updated_at_profile_team_memberships
  BEFORE UPDATE ON profile_team_memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_profile_reporting_lines ON profile_reporting_lines;
CREATE TRIGGER set_updated_at_profile_reporting_lines
  BEFORE UPDATE ON profile_reporting_lines
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_org_team_feature_modes ON org_team_feature_modes;
CREATE TRIGGER set_updated_at_org_team_feature_modes
  BEFORE UPDATE ON org_team_feature_modes
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

COMMIT;
