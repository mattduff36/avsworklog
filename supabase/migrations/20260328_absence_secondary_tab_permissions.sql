BEGIN;

ALTER TABLE public.absence_secondary_permission_exceptions
  ADD COLUMN IF NOT EXISTS see_manage_overview BOOLEAN,
  ADD COLUMN IF NOT EXISTS see_manage_reasons BOOLEAN,
  ADD COLUMN IF NOT EXISTS see_manage_work_shifts BOOLEAN,
  ADD COLUMN IF NOT EXISTS edit_manage_work_shifts BOOLEAN;

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
      'see_bookings_team',
      'add_edit_bookings_team',
      'see_allowances_team',
      'see_manage_work_shifts',
      'edit_manage_work_shifts',
      'authorise_bookings_team'
    );
  END IF;

  IF tier = 'supervisor' THEN
    RETURN permission_key IN (
      'see_bookings_team',
      'add_edit_bookings_team',
      'see_manage_work_shifts',
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
    WHEN 'see_manage_overview' THEN row_data.see_manage_overview
    WHEN 'see_manage_reasons' THEN row_data.see_manage_reasons
    WHEN 'see_manage_work_shifts' THEN row_data.see_manage_work_shifts
    WHEN 'edit_manage_work_shifts' THEN row_data.edit_manage_work_shifts
    WHEN 'authorise_bookings_all' THEN row_data.authorise_bookings_all
    WHEN 'authorise_bookings_team' THEN row_data.authorise_bookings_team
    WHEN 'authorise_bookings_own' THEN row_data.authorise_bookings_own
    ELSE NULL
  END;
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
      'see_manage_overview', absence_secondary_effective_cell(actor_profile_id, 'see_manage_overview'),
      'see_manage_reasons', absence_secondary_effective_cell(actor_profile_id, 'see_manage_reasons'),
      'see_manage_work_shifts', absence_secondary_effective_cell(actor_profile_id, 'see_manage_work_shifts'),
      'edit_manage_work_shifts', absence_secondary_effective_cell(actor_profile_id, 'edit_manage_work_shifts'),
      'authorise_bookings_all', absence_secondary_effective_cell(actor_profile_id, 'authorise_bookings_all'),
      'authorise_bookings_team', absence_secondary_effective_cell(actor_profile_id, 'authorise_bookings_team'),
      'authorise_bookings_own', absence_secondary_effective_cell(actor_profile_id, 'authorise_bookings_own')
    )
  );
END;
$$;

COMMIT;
