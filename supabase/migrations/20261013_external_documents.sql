-- finalise-phase: predeploy
-- External Documents: team-mode module at contractor minimum, zero team grants,
-- private metadata table, and a private storage bucket.
--
-- Rollback: disable grants rather than drop documents or storage objects.
--   UPDATE public.team_module_permissions
--      SET enabled = FALSE, updated_at = NOW()
--    WHERE module_name = 'external-documents';
--   UPDATE public.user_module_permissions
--      SET access_level = 0, updated_at = NOW()
--    WHERE module_name = 'external-documents';
-- Do not DROP public.external_documents, its functions, or the external-documents bucket.
-- Admin and super-admin resolution still returns Level 5 until a later reviewed
-- change retires the module row. That step is outside this rollback.

BEGIN;

INSERT INTO public.permission_modules (
  module_name,
  minimum_role_id,
  sort_order,
  access_mode,
  requires_sensitive_pin
)
SELECT
  'external-documents',
  roles.id,
  211,
  'team',
  FALSE
FROM public.roles
WHERE lower(trim(roles.name)) = 'contractor'
  AND roles.hierarchy_rank = 1
ORDER BY roles.id
LIMIT 1
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    access_mode = EXCLUDED.access_mode,
    updated_at = NOW();

UPDATE public.team_module_permissions
SET enabled = FALSE,
    updated_at = NOW()
WHERE module_name = 'external-documents'
  AND enabled IS DISTINCT FROM FALSE;

CREATE OR REPLACE FUNCTION public.external_documents_actor_access_level()
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF auth.uid() IS NULL THEN RETURN 0; END IF;
  -- Canonical helper detects explicit View As even when role/team is unchanged.
  RETURN public.permission_alignment_effective_module_access_level('external-documents');
END;
$fn$;

CREATE OR REPLACE FUNCTION public.external_documents_can_read(
  shared_with UUID[],
  is_archived BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  access_level INTEGER;
BEGIN
  access_level := public.external_documents_actor_access_level();
  IF access_level >= 4 THEN
    RETURN TRUE;
  END IF;
  IF access_level >= 1
     AND is_archived IS FALSE
     AND auth.uid() = ANY(COALESCE(shared_with, ARRAY[]::UUID[]))
  THEN
    RETURN TRUE;
  END IF;
  RETURN FALSE;
END;
$fn$;

REVOKE ALL ON FUNCTION public.external_documents_actor_access_level() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.external_documents_can_read(UUID[], BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.external_documents_actor_access_level() TO authenticated;
GRANT EXECUTE ON FUNCTION public.external_documents_can_read(UUID[], BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.external_documents_valid_sources(value JSONB)
RETURNS BOOLEAN LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp
AS $fn$
DECLARE item JSONB;
BEGIN
  IF value IS NULL OR jsonb_typeof(value) <> 'array' THEN RETURN FALSE; END IF;
  IF jsonb_array_length(value) NOT BETWEEN 1 AND 20 THEN RETURN FALSE; END IF;
  FOR item IN SELECT jsonb_array_elements(value) LOOP
    IF jsonb_typeof(item) <> 'string' OR char_length(item #>> '{}') NOT BETWEEN 1 AND 255 THEN
      RETURN FALSE;
    END IF;
  END LOOP;
  RETURN TRUE;
END;
$fn$;
REVOKE ALL ON FUNCTION public.external_documents_valid_sources(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.external_documents_valid_sources(JSONB) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.external_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  external_company TEXT NOT NULL,
  document_date DATE NOT NULL,
  expiry_date DATE,
  reference TEXT,
  notes TEXT,
  van_id UUID,
  plant_id UUID,
  hgv_id UUID,
  shared_with UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  file_name TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  page_count INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'upload',
  source_files JSONB NOT NULL,
  uploaded_by UUID NOT NULL,
  storage_path TEXT NOT NULL,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT external_documents_category_check CHECK (
    category IN (
      'Service record',
      'Inspection report',
      'Certificate',
      'Warranty',
      'Invoice',
      'Other'
    )
  ),
  CONSTRAINT external_documents_source_check CHECK (source = 'upload'),
  CONSTRAINT external_documents_title_check CHECK (
    char_length(btrim(title)) BETWEEN 1 AND 200
  ),
  CONSTRAINT external_documents_company_check CHECK (
    char_length(btrim(external_company)) BETWEEN 1 AND 200
  ),
  CONSTRAINT external_documents_reference_check CHECK (
    reference IS NULL OR char_length(reference) BETWEEN 1 AND 120
  ),
  CONSTRAINT external_documents_notes_check CHECK (
    notes IS NULL OR char_length(notes) BETWEEN 1 AND 4000
  ),
  CONSTRAINT external_documents_expiry_check CHECK (
    expiry_date IS NULL OR expiry_date >= document_date
  ),
  CONSTRAINT external_documents_one_asset_check CHECK (
    (CASE WHEN van_id IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN plant_id IS NULL THEN 0 ELSE 1 END)
    + (CASE WHEN hgv_id IS NULL THEN 0 ELSE 1 END) <= 1
  ),
  CONSTRAINT external_documents_file_name_check CHECK (
    char_length(file_name) BETWEEN 1 AND 180
    AND file_name !~ '[\\/]'
  ),
  CONSTRAINT external_documents_file_size_check CHECK (
    file_size BETWEEN 1 AND 4194304
  ),
  CONSTRAINT external_documents_page_count_check CHECK (
    page_count BETWEEN 1 AND 200
  ),
  CONSTRAINT external_documents_source_files_check CHECK (
    public.external_documents_valid_sources(source_files)
  ),
  CONSTRAINT external_documents_storage_path_check CHECK (
    storage_path ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'
  ),
  CONSTRAINT external_documents_storage_path_key UNIQUE (storage_path),
  CONSTRAINT external_documents_van_id_fkey
    FOREIGN KEY (van_id) REFERENCES public.vans(id) ON DELETE RESTRICT,
  CONSTRAINT external_documents_plant_id_fkey
    FOREIGN KEY (plant_id) REFERENCES public.plant(id) ON DELETE RESTRICT,
  CONSTRAINT external_documents_hgv_id_fkey
    FOREIGN KEY (hgv_id) REFERENCES public.hgvs(id) ON DELETE RESTRICT,
  CONSTRAINT external_documents_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS external_documents_updated_at_idx
  ON public.external_documents (is_archived, updated_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS external_documents_category_idx
  ON public.external_documents (category);
CREATE INDEX IF NOT EXISTS external_documents_van_id_idx
  ON public.external_documents (van_id) WHERE van_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_documents_plant_id_idx
  ON public.external_documents (plant_id) WHERE plant_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_documents_hgv_id_idx
  ON public.external_documents (hgv_id) WHERE hgv_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS external_documents_shared_with_idx
  ON public.external_documents USING GIN (shared_with);
CREATE INDEX IF NOT EXISTS external_documents_uploaded_by_idx
  ON public.external_documents (uploaded_by);

DROP TRIGGER IF EXISTS set_updated_at_external_documents ON public.external_documents;
CREATE TRIGGER set_updated_at_external_documents
  BEFORE UPDATE ON public.external_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.external_documents_validate_shared_with()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $fn$
BEGIN
  IF NEW.shared_with IS NULL THEN
    NEW.shared_with := ARRAY[]::UUID[];
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(NEW.shared_with) AS reader(id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE profiles.id = reader.id
        AND profiles.deleted_at IS NULL
        AND profiles.is_placeholder IS NOT TRUE
        AND profiles.is_system_account IS NOT TRUE
    )
  ) THEN
    RAISE EXCEPTION 'shared_with contains an unknown profile'
      USING ERRCODE = '23503';
  END IF;

  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.external_documents_validate_shared_with()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS external_documents_validate_shared_with ON public.external_documents;
CREATE TRIGGER external_documents_validate_shared_with
  BEFORE INSERT OR UPDATE OF shared_with ON public.external_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.external_documents_validate_shared_with();

ALTER TABLE public.external_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.external_documents FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS external_documents_select_authorized ON public.external_documents;
CREATE POLICY external_documents_select_authorized
  ON public.external_documents
  FOR SELECT
  TO authenticated
  USING (public.external_documents_can_read(shared_with, is_archived));

REVOKE ALL ON TABLE public.external_documents FROM PUBLIC, anon, authenticated;
-- All reads use the guarded API, including optional session-specific PIN checks.
-- Keep RLS as defense in depth, without granting a direct metadata bypass.

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.external_documents TO service_role;
    GRANT EXECUTE ON FUNCTION public.external_documents_validate_shared_with() TO service_role;
  END IF;
END
$grants$;

INSERT INTO storage.buckets (id, name, public)
VALUES ('external-documents', 'external-documents', FALSE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    public = FALSE;

-- Restrictive exclusion also defeats unrelated permissive bucket-wide policies.
DROP POLICY IF EXISTS external_documents_private_storage ON storage.objects;
CREATE POLICY external_documents_private_storage ON storage.objects
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING (bucket_id <> 'external-documents')
  WITH CHECK (bucket_id <> 'external-documents');

DO $checks$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.permission_modules
    JOIN public.roles ON roles.id = permission_modules.minimum_role_id
    WHERE permission_modules.module_name = 'external-documents'
      AND permission_modules.access_mode = 'team'
      AND lower(trim(roles.name)) = 'contractor'
      AND roles.hierarchy_rank = 1
  ) THEN
    RAISE EXCEPTION 'external-documents is not team mode at contractor rank 1';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.team_module_permissions
    WHERE module_name = 'external-documents'
      AND enabled IS TRUE
  ) THEN
    RAISE EXCEPTION 'external-documents must not have an enabled team grant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'external_documents'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) THEN
    RAISE EXCEPTION 'external_documents must not allow direct mutation policies';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_class
    JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_class.relname = 'external_documents'
      AND pg_class.relrowsecurity
      AND pg_class.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'external_documents row security is not forced';
  END IF;

  IF has_table_privilege('authenticated', 'public.external_documents', 'INSERT')
     OR has_table_privilege('authenticated', 'public.external_documents', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.external_documents', 'DELETE')
     OR has_table_privilege('anon', 'public.external_documents', 'SELECT')
  THEN
    RAISE EXCEPTION 'external_documents grants are too broad';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc
    JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
    WHERE pg_namespace.nspname = 'public'
      AND pg_proc.proname = 'external_documents_actor_access_level'
      AND pg_proc.prosecdef
      AND EXISTS (
        SELECT 1
        FROM unnest(COALESCE(pg_proc.proconfig, ARRAY[]::TEXT[])) AS config(value)
        WHERE config.value = 'search_path=public, pg_temp'
      )
  ) THEN
    RAISE EXCEPTION 'external_documents_actor_access_level is not locked down';
  END IF;
END
$checks$;

COMMIT;
