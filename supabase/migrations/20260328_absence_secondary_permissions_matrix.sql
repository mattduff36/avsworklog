BEGIN;

CREATE TABLE IF NOT EXISTS public.absence_secondary_permission_exceptions (
  profile_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  see_bookings_all BOOLEAN,
  see_bookings_team BOOLEAN,
  see_bookings_own BOOLEAN,
  add_edit_bookings_all BOOLEAN,
  add_edit_bookings_team BOOLEAN,
  add_edit_bookings_own BOOLEAN,
  see_allowances_all BOOLEAN,
  see_allowances_team BOOLEAN,
  add_edit_allowances_all BOOLEAN,
  add_edit_allowances_team BOOLEAN,
  authorise_bookings_all BOOLEAN,
  authorise_bookings_team BOOLEAN,
  authorise_bookings_own BOOLEAN,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absence_secondary_permission_exceptions_updated_at
  ON public.absence_secondary_permission_exceptions(updated_at DESC);

ALTER TABLE public.absence_secondary_permission_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own absence secondary exceptions" ON public.absence_secondary_permission_exceptions;
CREATE POLICY "Users can view own absence secondary exceptions"
  ON public.absence_secondary_permission_exceptions
  FOR SELECT
  USING (auth.uid() = profile_id OR is_actor_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can manage absence secondary exceptions" ON public.absence_secondary_permission_exceptions;
CREATE POLICY "Admins can manage absence secondary exceptions"
  ON public.absence_secondary_permission_exceptions
  FOR ALL
  USING (is_actor_admin(auth.uid()))
  WITH CHECK (is_actor_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public.absence_secondary_role_tier(
  actor_profile_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  role_name TEXT;
  role_class TEXT;
  role_is_super_admin BOOLEAN;
  role_is_manager_admin BOOLEAN;
BEGIN
  IF actor_profile_id IS NULL THEN
    RETURN 'employee';
  END IF;

  SELECT
    r.name,
    r.role_class,
    COALESCE(r.is_super_admin, FALSE),
    COALESCE(r.is_manager_admin, FALSE)
  INTO
    role_name,
    role_class,
    role_is_super_admin,
    role_is_manager_admin
  FROM public.profiles p
  JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = actor_profile_id;

  IF role_is_super_admin OR role_name = 'admin' OR role_class = 'admin' THEN
    RETURN 'admin';
  END IF;

  IF role_class = 'manager' OR role_is_manager_admin THEN
    RETURN 'manager';
  END IF;

  IF LOWER(COALESCE(role_name, '')) = 'supervisor' THEN
    RETURN 'supervisor';
  END IF;

  RETURN 'employee';
END;
$$;

CREATE OR REPLACE FUNCTION public.absence_secondary_default_cell(
  actor_profile_id UUID,
  permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tier TEXT;
BEGIN
  tier := absence_secondary_role_tier(actor_profile_id);

  IF tier = 'admin' THEN
    RETURN TRUE;
  END IF;

  IF tier = 'manager' THEN
    RETURN permission_key IN (
      'see_bookings_all',
      'see_bookings_team',
      'see_bookings_own',
      'add_edit_bookings_team',
      'add_edit_bookings_own',
      'see_allowances_team',
      'authorise_bookings_team',
      'authorise_bookings_own'
    );
  END IF;

  IF tier = 'supervisor' THEN
    RETURN permission_key IN (
      'see_bookings_all',
      'see_bookings_team',
      'see_bookings_own',
      'add_edit_bookings_team',
      'authorise_bookings_team'
    );
  END IF;

  RETURN permission_key IN (
    'see_bookings_own',
    'add_edit_bookings_own'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.absence_secondary_exception_cell(
  actor_profile_id UUID,
  permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  row_data public.absence_secondary_permission_exceptions%ROWTYPE;
BEGIN
  IF actor_profile_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT *
  INTO row_data
  FROM public.absence_secondary_permission_exceptions
  WHERE profile_id = actor_profile_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN CASE permission_key
    WHEN 'see_bookings_all' THEN row_data.see_bookings_all
    WHEN 'see_bookings_team' THEN row_data.see_bookings_team
    WHEN 'see_bookings_own' THEN row_data.see_bookings_own
    WHEN 'add_edit_bookings_all' THEN row_data.add_edit_bookings_all
    WHEN 'add_edit_bookings_team' THEN row_data.add_edit_bookings_team
    WHEN 'add_edit_bookings_own' THEN row_data.add_edit_bookings_own
    WHEN 'see_allowances_all' THEN row_data.see_allowances_all
    WHEN 'see_allowances_team' THEN row_data.see_allowances_team
    WHEN 'add_edit_allowances_all' THEN row_data.add_edit_allowances_all
    WHEN 'add_edit_allowances_team' THEN row_data.add_edit_allowances_team
    WHEN 'authorise_bookings_all' THEN row_data.authorise_bookings_all
    WHEN 'authorise_bookings_team' THEN row_data.authorise_bookings_team
    WHEN 'authorise_bookings_own' THEN row_data.authorise_bookings_own
    ELSE NULL
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public.absence_secondary_effective_cell(
  actor_profile_id UUID,
  permission_key TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  overridden_value BOOLEAN;
BEGIN
  overridden_value := absence_secondary_exception_cell(actor_profile_id, permission_key);
  RETURN COALESCE(overridden_value, absence_secondary_default_cell(actor_profile_id, permission_key));
END;
$$;

CREATE OR REPLACE FUNCTION public.are_profiles_in_same_team(
  actor_profile_id UUID,
  target_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  actor_team_id TEXT;
  target_team_id TEXT;
BEGIN
  IF actor_profile_id IS NULL OR target_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT p.team_id
  INTO actor_team_id
  FROM public.profiles p
  WHERE p.id = actor_profile_id;

  SELECT p.team_id
  INTO target_team_id
  FROM public.profiles p
  WHERE p.id = target_profile_id;

  RETURN actor_team_id IS NOT NULL AND target_team_id IS NOT NULL AND actor_team_id = target_team_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_secondary_absence_permission(
  actor_profile_id UUID,
  target_profile_id UUID,
  permission_prefix TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF actor_profile_id IS NULL OR permission_prefix IS NULL OR permission_prefix = '' THEN
    RETURN FALSE;
  END IF;

  IF absence_secondary_effective_cell(actor_profile_id, permission_prefix || '_all') THEN
    RETURN TRUE;
  END IF;

  IF target_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF actor_profile_id = target_profile_id
     AND absence_secondary_effective_cell(actor_profile_id, permission_prefix || '_own') THEN
    RETURN TRUE;
  END IF;

  IF are_profiles_in_same_team(actor_profile_id, target_profile_id)
     AND absence_secondary_effective_cell(actor_profile_id, permission_prefix || '_team') THEN
    RETURN TRUE;
  END IF;

  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_actor_absence_secondary_editor(
  actor_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  tier TEXT;
BEGIN
  tier := absence_secondary_role_tier(actor_profile_id);
  RETURN tier IN ('admin', 'manager', 'supervisor');
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_access_absence_request(
  actor_profile_id UUID,
  requester_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN can_actor_secondary_absence_permission(
    actor_profile_id,
    requester_profile_id,
    'see_bookings'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_edit_absence_request(
  actor_profile_id UUID,
  requester_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN can_actor_secondary_absence_permission(
    actor_profile_id,
    requester_profile_id,
    'add_edit_bookings'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_approve_absence_request(
  actor_profile_id UUID,
  requester_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF actor_profile_id IS NULL OR requester_profile_id IS NULL THEN
    RETURN FALSE;
  END IF;

  IF actor_profile_id = requester_profile_id THEN
    RETURN FALSE;
  END IF;

  RETURN can_actor_secondary_absence_permission(
    actor_profile_id,
    requester_profile_id,
    'authorise_bookings'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_view_absence_allowances(
  actor_profile_id UUID,
  target_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN can_actor_secondary_absence_permission(
    actor_profile_id,
    target_profile_id,
    'see_allowances'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.can_actor_edit_absence_allowances(
  actor_profile_id UUID,
  target_profile_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN can_actor_secondary_absence_permission(
    actor_profile_id,
    target_profile_id,
    'add_edit_allowances'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_absence_secondary_permissions_snapshot(
  actor_profile_id UUID DEFAULT auth.uid()
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  RETURN jsonb_build_object(
    'role_tier', absence_secondary_role_tier(actor_profile_id),
    'permissions', jsonb_build_object(
      'see_bookings_all', absence_secondary_effective_cell(actor_profile_id, 'see_bookings_all'),
      'see_bookings_team', absence_secondary_effective_cell(actor_profile_id, 'see_bookings_team'),
      'see_bookings_own', absence_secondary_effective_cell(actor_profile_id, 'see_bookings_own'),
      'add_edit_bookings_all', absence_secondary_effective_cell(actor_profile_id, 'add_edit_bookings_all'),
      'add_edit_bookings_team', absence_secondary_effective_cell(actor_profile_id, 'add_edit_bookings_team'),
      'add_edit_bookings_own', absence_secondary_effective_cell(actor_profile_id, 'add_edit_bookings_own'),
      'see_allowances_all', absence_secondary_effective_cell(actor_profile_id, 'see_allowances_all'),
      'see_allowances_team', absence_secondary_effective_cell(actor_profile_id, 'see_allowances_team'),
      'add_edit_allowances_all', absence_secondary_effective_cell(actor_profile_id, 'add_edit_allowances_all'),
      'add_edit_allowances_team', absence_secondary_effective_cell(actor_profile_id, 'add_edit_allowances_team'),
      'authorise_bookings_all', absence_secondary_effective_cell(actor_profile_id, 'authorise_bookings_all'),
      'authorise_bookings_team', absence_secondary_effective_cell(actor_profile_id, 'authorise_bookings_team'),
      'authorise_bookings_own', absence_secondary_effective_cell(actor_profile_id, 'authorise_bookings_own')
    )
  );
END;
$$;

DROP POLICY IF EXISTS "Managers can view all absences" ON public.absences;
DROP POLICY IF EXISTS "Managers can update absences" ON public.absences;
DROP POLICY IF EXISTS "Managers can create absences" ON public.absences;
DROP POLICY IF EXISTS "Managers can view scoped absences" ON public.absences;
DROP POLICY IF EXISTS "Managers can update scoped absences" ON public.absences;
DROP POLICY IF EXISTS "Managers can create scoped absences" ON public.absences;
DROP POLICY IF EXISTS "Absence viewers can read scoped absences" ON public.absences;
DROP POLICY IF EXISTS "Absence editors can update scoped absences" ON public.absences;
DROP POLICY IF EXISTS "Absence editors can create scoped absences" ON public.absences;
DROP POLICY IF EXISTS "Absence editors can delete scoped absences" ON public.absences;

CREATE POLICY "Absence viewers can read scoped absences"
  ON public.absences
  FOR SELECT
  USING (
    can_actor_access_absence_request(auth.uid(), profile_id)
  );

CREATE POLICY "Absence editors can update scoped absences"
  ON public.absences
  FOR UPDATE
  USING (
    is_actor_absence_secondary_editor(auth.uid())
    AND (
      can_actor_edit_absence_request(auth.uid(), profile_id)
      OR can_actor_approve_absence_request(auth.uid(), profile_id)
    )
  )
  WITH CHECK (
    is_actor_absence_secondary_editor(auth.uid())
    AND (
      can_actor_edit_absence_request(auth.uid(), profile_id)
      OR can_actor_approve_absence_request(auth.uid(), profile_id)
    )
  );

CREATE POLICY "Absence editors can create scoped absences"
  ON public.absences
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_actor_absence_secondary_editor(auth.uid())
    AND can_actor_edit_absence_request(auth.uid(), profile_id)
  );

CREATE POLICY "Absence editors can delete scoped absences"
  ON public.absences
  FOR DELETE
  USING (
    is_actor_absence_secondary_editor(auth.uid())
    AND can_actor_edit_absence_request(auth.uid(), profile_id)
  );

DROP POLICY IF EXISTS "Managers can view all archived absences" ON public.absences_archive;
DROP POLICY IF EXISTS "Managers can view scoped archived absences" ON public.absences_archive;
DROP POLICY IF EXISTS "Absence viewers can read scoped archived absences" ON public.absences_archive;

CREATE POLICY "Absence viewers can read scoped archived absences"
  ON public.absences_archive
  FOR SELECT
  USING (
    can_actor_access_absence_request(auth.uid(), profile_id)
  );

REVOKE ALL ON FUNCTION public.absence_secondary_role_tier(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.absence_secondary_role_tier(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.absence_secondary_default_cell(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.absence_secondary_default_cell(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.absence_secondary_exception_cell(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.absence_secondary_exception_cell(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.absence_secondary_effective_cell(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.absence_secondary_effective_cell(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.are_profiles_in_same_team(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.are_profiles_in_same_team(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_actor_secondary_absence_permission(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_actor_secondary_absence_permission(UUID, UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.is_actor_absence_secondary_editor(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_actor_absence_secondary_editor(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_actor_access_absence_request(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_actor_access_absence_request(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_actor_edit_absence_request(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_actor_edit_absence_request(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_actor_approve_absence_request(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_actor_approve_absence_request(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_actor_view_absence_allowances(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_actor_view_absence_allowances(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.can_actor_edit_absence_allowances(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_actor_edit_absence_allowances(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.get_absence_secondary_permissions_snapshot(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_absence_secondary_permissions_snapshot(UUID) TO authenticated;

COMMIT;
