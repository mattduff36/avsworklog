BEGIN;

-- Re-apply canonical default matrix after 20260328 migrations.
-- This ensures fresh environments finish with defaults aligned to
-- TypeScript MANAGER_TRUE_KEYS / SUPERVISOR_TRUE_KEYS.
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
      'see_manage_work_shifts',
      'edit_manage_work_shifts',
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

COMMIT;
