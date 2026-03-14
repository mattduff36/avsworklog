BEGIN;

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS role_class TEXT;

UPDATE public.roles
SET role_class = CASE
  WHEN name = 'admin' THEN 'admin'
  WHEN is_manager_admin = TRUE THEN 'manager'
  ELSE 'employee'
END
WHERE role_class IS NULL
   OR role_class NOT IN ('admin', 'manager', 'employee');

ALTER TABLE public.roles
  ALTER COLUMN role_class SET DEFAULT 'employee';

ALTER TABLE public.roles
  ALTER COLUMN role_class SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'roles_role_class_check'
      AND conrelid = 'public.roles'::regclass
  ) THEN
    ALTER TABLE public.roles
      ADD CONSTRAINT roles_role_class_check
      CHECK (role_class IN ('admin', 'manager', 'employee'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_roles_role_class
  ON public.roles (role_class);

CREATE OR REPLACE FUNCTION public.effective_role_class()
RETURNS TEXT AS $$
DECLARE
  class_name TEXT;
BEGIN
  SELECT r.role_class
  INTO class_name
  FROM public.roles r
  WHERE r.id = effective_role_id();

  RETURN COALESCE(class_name, 'employee');
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN effective_role_class() = 'admin' OR effective_is_super_admin();
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_is_manager()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN effective_role_class() = 'manager';
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.effective_can_assign_role(target_role_id UUID)
RETURNS BOOLEAN AS $$
DECLARE
  eff_role_class TEXT;
  eff_is_super BOOLEAN;
  target_role_class TEXT;
  target_is_super BOOLEAN;
BEGIN
  IF effective_role_id() IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT role_class, is_super_admin
  INTO eff_role_class, eff_is_super
  FROM public.roles
  WHERE id = effective_role_id();

  IF COALESCE(eff_is_super, FALSE) OR eff_role_class = 'admin' THEN
    RETURN TRUE;
  END IF;

  SELECT role_class, is_super_admin
  INTO target_role_class, target_is_super
  FROM public.roles
  WHERE id = target_role_id;

  IF target_role_class IS NULL THEN
    RETURN FALSE;
  END IF;

  IF COALESCE(target_is_super, FALSE) THEN
    RETURN FALSE;
  END IF;

  IF eff_role_class = 'manager' THEN
    RETURN target_role_class = 'employee';
  END IF;

  RETURN FALSE;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

DROP POLICY IF EXISTS "Only admins can insert roles" ON public.roles;
CREATE POLICY "Only admins can insert roles" ON public.roles
FOR INSERT TO authenticated
WITH CHECK (
  effective_is_super_admin()
  OR effective_role_class() = 'admin'
  OR (
    effective_role_class() = 'manager'
    AND role_class = 'employee'
    AND COALESCE(is_super_admin, FALSE) = FALSE
    AND COALESCE(is_manager_admin, FALSE) = FALSE
  )
);

COMMIT;
