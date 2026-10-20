-- finalise-phase: predeploy
-- No user/team grants. Enable approved readers and document controllers manually.
-- Rollback: disable team grants and set user overrides to 0 for policies-procedures;
-- retain all documents, versions, audit records and storage objects. Admin retains access.
BEGIN;
INSERT INTO public.permission_modules(module_name, minimum_role_id, sort_order, access_mode, requires_sensitive_pin)
SELECT 'policies-procedures', id, 212, 'team', false FROM public.roles
WHERE lower(trim(name)) = 'contractor' AND hierarchy_rank = 1 ORDER BY id LIMIT 1
ON CONFLICT (module_name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.policy_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL CHECK (length(reference) BETWEEN 1 AND 100),
  is_archived boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_document_reference ON public.policy_documents(lower(reference));
CREATE TABLE IF NOT EXISTS public.policy_document_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.policy_documents(id),
  version integer NOT NULL CHECK (version > 0),
  version_label text NOT NULL CHECK (length(version_label) BETWEEN 1 AND 60),
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  category text NOT NULL CHECK (category IN ('Company policies','Environmental procedures','Health and safety procedures','Quality management procedures','Manuals and handbooks')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','superseded')),
  effective_date date,
  review_date date,
  notes text NOT NULL DEFAULT '' CHECK (length(notes) <= 4000),
  storage_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0 AND file_size <= 4194304),
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid REFERENCES public.profiles(id),
  published_at timestamptz,
  UNIQUE(document_id, version),
  CHECK(review_date IS NULL OR effective_date IS NULL OR review_date >= effective_date),
  CHECK(status = 'draft' OR (published_by IS NOT NULL AND published_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS policy_one_published_version ON public.policy_document_versions(document_id) WHERE status='published';
CREATE TABLE IF NOT EXISTS public.policy_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.policy_documents(id),
  version_id uuid REFERENCES public.policy_document_versions(id),
  action text NOT NULL CHECK(action IN ('upload','publish','archive','restore')),
  actor_id uuid NOT NULL REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
-- Access is only through the session/PIN/effective-level guarded server routes.
ALTER TABLE public.policy_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_documents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.policy_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_document_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.policy_document_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_document_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.policy_documents, public.policy_document_versions, public.policy_document_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.policy_documents, public.policy_document_versions, public.policy_document_events TO service_role;
INSERT INTO storage.buckets(id,name,public) VALUES ('policies-procedures','policies-procedures',false)
ON CONFLICT(id) DO UPDATE SET public=false;
-- Restrictive policies prevent permissive legacy storage policies exposing files.
DROP POLICY IF EXISTS policy_documents_private ON storage.objects;
CREATE POLICY policy_documents_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
USING(bucket_id <> 'policies-procedures') WITH CHECK(bucket_id <> 'policies-procedures');
COMMIT;
