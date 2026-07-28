BEGIN;

CREATE TEMP TABLE target_van_assignments
ON COMMIT DROP
AS
SELECT
  v.id AS van_id,
  BTRIM(v.reg_number) AS reg_number,
  p.id AS user_id,
  BTRIM(p.full_name) AS user_name
FROM public.vans v
JOIN public.profiles p
  ON LOWER(BTRIM(p.full_name)) = LOWER(BTRIM(v.nickname))
WHERE v.status = 'active'
  AND BTRIM(v.reg_number) NOT IN (
    'FH13 XPT', -- Confirmed pool/spare despite its legacy nickname.
    'GP07 NBZ'  -- Confirmed pool/spare; Rob Squires uses YG26 SVU.
  );

DO $$
DECLARE
  target_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO target_count
  FROM target_van_assignments;

  IF target_count <> 47 THEN
    RAISE EXCEPTION
      'Expected 47 assigned active vans, found %. Nicknames or profiles changed; review before linking.',
      target_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM target_van_assignments
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A user is assigned to more than one target van';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM target_van_assignments
    GROUP BY van_id
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'A target van resolves to more than one user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM target_van_assignments target
    JOIN public.profile_fleet_assignments current_assignment
      ON current_assignment.user_id = target.user_id
     AND current_assignment.ended_at IS NULL
    WHERE current_assignment.linked_van_id IS DISTINCT FROM target.van_id
  ) THEN
    RAISE EXCEPTION 'A target user already has a different current fleet assignment';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM target_van_assignments target
    JOIN public.profile_fleet_assignments current_assignment
      ON current_assignment.linked_van_id = target.van_id
     AND current_assignment.ended_at IS NULL
    WHERE current_assignment.user_id <> target.user_id
  ) THEN
    RAISE EXCEPTION 'A target van is already linked to a different user';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM target_van_assignments target
    JOIN public.inventory_locations location
      ON location.is_active = TRUE
     AND LOWER(BTRIM(location.name)) = LOWER('Van - ' || target.reg_number)
    WHERE location.linked_van_id IS DISTINCT FROM target.van_id
  ) THEN
    RAISE EXCEPTION 'An active inventory location name conflicts with a target van';
  END IF;
END
$$;

INSERT INTO public.inventory_locations (
  name,
  description,
  is_active,
  linked_van_id,
  linked_hgv_id,
  linked_plant_id,
  location_type,
  source_type,
  sync_status,
  source_synced_at
)
SELECT
  'Van - ' || target.reg_number,
  'Synced from active fleet van: ' || target.user_name,
  TRUE,
  target.van_id,
  NULL,
  NULL,
  'van',
  'fleet',
  'synced',
  NOW()
FROM target_van_assignments target
WHERE NOT EXISTS (
  SELECT 1
  FROM public.inventory_locations location
  WHERE location.linked_van_id = target.van_id
    AND location.is_active = TRUE
);

DO $$
DECLARE
  target RECORD;
  target_location_id UUID;
  current_assignment_id UUID;
BEGIN
  FOR target IN
    SELECT *
    FROM target_van_assignments
    ORDER BY reg_number
  LOOP
    SELECT location.id
    INTO STRICT target_location_id
    FROM public.inventory_locations location
    WHERE location.linked_van_id = target.van_id
      AND location.is_active = TRUE;

    SELECT assignment.id
    INTO current_assignment_id
    FROM public.profile_fleet_assignments assignment
    WHERE assignment.user_id = target.user_id
      AND assignment.linked_van_id = target.van_id
      AND assignment.ended_at IS NULL;

    IF current_assignment_id IS NULL THEN
      PERFORM public.inventory_set_user_location_with_assignment(
        target.user_id,
        target_location_id,
        'Backfilled from confirmed van-to-user assignment table',
        NULL
      );
    ELSE
      INSERT INTO public.inventory_user_locations (
        user_id,
        location_id,
        change_reason,
        updated_by
      )
      VALUES (
        target.user_id,
        target_location_id,
        'Aligned with confirmed current fleet assignment',
        NULL
      )
      ON CONFLICT (user_id) DO UPDATE
      SET location_id = EXCLUDED.location_id,
          change_reason = EXCLUDED.change_reason,
          updated_by = EXCLUDED.updated_by,
          updated_at = NOW();
    END IF;
  END LOOP;
END
$$;

DO $$
DECLARE
  linked_count INTEGER;
  location_count INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO linked_count
  FROM target_van_assignments target
  JOIN public.profile_fleet_assignments assignment
    ON assignment.user_id = target.user_id
   AND assignment.linked_van_id = target.van_id
   AND assignment.ended_at IS NULL;

  IF linked_count <> 47 THEN
    RAISE EXCEPTION 'Expected 47 current van links after backfill, found %', linked_count;
  END IF;

  SELECT COUNT(*)
  INTO location_count
  FROM target_van_assignments target
  JOIN public.inventory_locations location
    ON location.linked_van_id = target.van_id
   AND location.is_active = TRUE
  JOIN public.inventory_user_locations user_location
    ON user_location.user_id = target.user_id
   AND user_location.location_id = location.id;

  IF location_count <> 47 THEN
    RAISE EXCEPTION 'Expected 47 aligned inventory locations after backfill, found %', location_count;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.profile_fleet_assignments assignment
    JOIN public.vans van
      ON van.id = assignment.linked_van_id
    WHERE assignment.ended_at IS NULL
      AND van.status = 'archived'
  ) THEN
    RAISE EXCEPTION 'An archived van still has a current fleet assignment';
  END IF;
END
$$;

COMMIT;
