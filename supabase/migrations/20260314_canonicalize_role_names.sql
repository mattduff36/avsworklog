BEGIN;

CREATE TEMP TABLE role_slug_map (
  role_id UUID PRIMARY KEY,
  old_name TEXT NOT NULL,
  new_name TEXT NOT NULL
) ON COMMIT DROP;

WITH base AS (
  SELECT
    r.id,
    r.name AS old_name,
    r.created_at,
    COALESCE(
      NULLIF(
        regexp_replace(
          regexp_replace(lower(trim(r.name)), '[^a-z0-9]+', '-', 'g'),
          '(^-+|-+$)',
          '',
          'g'
        ),
        ''
      ),
      'role'
    ) AS base_slug
  FROM public.roles r
),
ranked AS (
  SELECT
    b.id,
    b.old_name,
    b.base_slug,
    ROW_NUMBER() OVER (PARTITION BY b.base_slug ORDER BY b.created_at, b.id) AS slug_ordinal
  FROM base b
)
INSERT INTO role_slug_map (role_id, old_name, new_name)
SELECT
  r.id,
  r.old_name,
  CASE
    WHEN r.slug_ordinal = 1 THEN r.base_slug
    ELSE r.base_slug || '-' || r.slug_ordinal::TEXT
  END AS new_name
FROM ranked r;

UPDATE public.roles r
SET name = m.new_name
FROM role_slug_map m
WHERE r.id = m.role_id
  AND r.name <> m.new_name;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'role'
  ) THEN
    UPDATE public.profiles p
    SET role = m.new_name
    FROM role_slug_map m
    WHERE p.role = m.old_name;
  END IF;
END $$;

UPDATE public.absence_bulk_batches b
SET role_names = (
  SELECT COALESCE(array_agg(COALESCE(m.new_name, r.role_name) ORDER BY r.ordinality), ARRAY[]::TEXT[])
  FROM unnest(COALESCE(b.role_names, ARRAY[]::TEXT[])) WITH ORDINALITY AS r(role_name, ordinality)
  LEFT JOIN role_slug_map m
    ON lower(trim(r.role_name)) = lower(trim(m.old_name))
)
WHERE COALESCE(array_length(b.role_names, 1), 0) > 0;

COMMIT;
