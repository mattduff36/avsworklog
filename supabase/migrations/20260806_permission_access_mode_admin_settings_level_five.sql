-- Phase 1 permission alignment:
-- 1) Expose access_mode on permission_modules (default team; reminders universal)
-- 2) Align DB hard rule for admin-settings with TypeScript (Level 5)
-- Deliberate non-admin Level 5 overrides remain allowed (module_requires_full_access_role stays false).

BEGIN;

ALTER TABLE public.permission_modules
  ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'team';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'permission_modules_access_mode_check'
      AND conrelid = 'public.permission_modules'::regclass
  ) THEN
    ALTER TABLE public.permission_modules
      ADD CONSTRAINT permission_modules_access_mode_check
      CHECK (access_mode IN ('team', 'universal'));
  END IF;
END $$;

UPDATE public.permission_modules
SET
  access_mode = 'universal',
  updated_at = NOW()
WHERE module_name = 'reminders';

CREATE OR REPLACE FUNCTION public.module_enforced_minimum_access_level(target_module TEXT)
RETURNS INTEGER AS $$
DECLARE
  configured_min_rank INTEGER;
  hard_rule_min_rank INTEGER;
BEGIN
  SELECT r.hierarchy_rank
  INTO configured_min_rank
  FROM public.permission_modules pm
  JOIN public.roles r ON r.id = pm.minimum_role_id
  WHERE pm.module_name = target_module;

  hard_rule_min_rank := CASE target_module
    WHEN 'toolbox-talks' THEN 4
    WHEN 'admin-settings' THEN 5
    ELSE NULL
  END;

  configured_min_rank := COALESCE(configured_min_rank, 0);

  IF hard_rule_min_rank IS NOT NULL AND hard_rule_min_rank > configured_min_rank THEN
    configured_min_rank := hard_rule_min_rank;
  END IF;

  RETURN LEAST(GREATEST(configured_min_rank, 0), 5);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

COMMIT;
