BEGIN;

-- ============================================================================
-- ORG HIERARCHY ABSENCE RLS (DUAL-MODE LEGACY + ORG_V2)
-- ============================================================================

ALTER TABLE absences ENABLE ROW LEVEL SECURITY;
ALTER TABLE absences_archive ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can view all absences" ON absences;
DROP POLICY IF EXISTS "Managers can update absences" ON absences;
DROP POLICY IF EXISTS "Managers can create absences" ON absences;
DROP POLICY IF EXISTS "Managers can view scoped absences" ON absences;
DROP POLICY IF EXISTS "Managers can update scoped absences" ON absences;
DROP POLICY IF EXISTS "Managers can create scoped absences" ON absences;

CREATE POLICY "Managers can view scoped absences" ON absences
FOR SELECT USING (
  effective_is_manager_admin()
  AND can_actor_access_absence_request(auth.uid(), profile_id)
);

CREATE POLICY "Managers can update scoped absences" ON absences
FOR UPDATE USING (
  effective_is_manager_admin()
  AND can_actor_approve_absence_request(auth.uid(), profile_id)
)
WITH CHECK (
  effective_is_manager_admin()
  AND can_actor_approve_absence_request(auth.uid(), profile_id)
);

CREATE POLICY "Managers can create scoped absences" ON absences
FOR INSERT
TO authenticated
WITH CHECK (
  effective_is_manager_admin()
  AND can_actor_access_absence_request(auth.uid(), profile_id)
);

DROP POLICY IF EXISTS "Managers can view all archived absences" ON absences_archive;
DROP POLICY IF EXISTS "Managers can view scoped archived absences" ON absences_archive;

CREATE POLICY "Managers can view scoped archived absences" ON absences_archive
FOR SELECT USING (
  effective_is_manager_admin()
  AND can_actor_access_absence_request(auth.uid(), profile_id)
);

-- ============================================================================
-- RLS FOR ORG HIERARCHY TABLES
-- ============================================================================

ALTER TABLE org_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_team_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE profile_reporting_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_team_feature_modes ENABLE ROW LEVEL SECURITY;
ALTER TABLE org_hierarchy_change_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Managers can read org teams" ON org_teams;
DROP POLICY IF EXISTS "Admins can manage org teams" ON org_teams;
CREATE POLICY "Managers can read org teams" ON org_teams
FOR SELECT USING (effective_is_manager_admin());
CREATE POLICY "Admins can manage org teams" ON org_teams
FOR ALL USING (is_actor_admin(auth.uid()))
WITH CHECK (is_actor_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can read team memberships" ON profile_team_memberships;
DROP POLICY IF EXISTS "Admins can manage team memberships" ON profile_team_memberships;
CREATE POLICY "Managers can read team memberships" ON profile_team_memberships
FOR SELECT USING (effective_is_manager_admin());
CREATE POLICY "Admins can manage team memberships" ON profile_team_memberships
FOR ALL USING (is_actor_admin(auth.uid()))
WITH CHECK (is_actor_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can read reporting lines" ON profile_reporting_lines;
DROP POLICY IF EXISTS "Admins can manage reporting lines" ON profile_reporting_lines;
CREATE POLICY "Managers can read reporting lines" ON profile_reporting_lines
FOR SELECT USING (effective_is_manager_admin());
CREATE POLICY "Admins can manage reporting lines" ON profile_reporting_lines
FOR ALL USING (is_actor_admin(auth.uid()))
WITH CHECK (is_actor_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can read team feature modes" ON org_team_feature_modes;
DROP POLICY IF EXISTS "Admins can manage team feature modes" ON org_team_feature_modes;
CREATE POLICY "Managers can read team feature modes" ON org_team_feature_modes
FOR SELECT USING (effective_is_manager_admin());
CREATE POLICY "Admins can manage team feature modes" ON org_team_feature_modes
FOR ALL USING (is_actor_admin(auth.uid()))
WITH CHECK (is_actor_admin(auth.uid()));

DROP POLICY IF EXISTS "Managers can read hierarchy change log" ON org_hierarchy_change_log;
DROP POLICY IF EXISTS "Admins can manage hierarchy change log" ON org_hierarchy_change_log;
CREATE POLICY "Managers can read hierarchy change log" ON org_hierarchy_change_log
FOR SELECT USING (effective_is_manager_admin());
CREATE POLICY "Admins can manage hierarchy change log" ON org_hierarchy_change_log
FOR ALL USING (is_actor_admin(auth.uid()))
WITH CHECK (is_actor_admin(auth.uid()));

COMMIT;
