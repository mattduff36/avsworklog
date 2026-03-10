BEGIN;

ALTER TABLE public.actions
  ADD COLUMN IF NOT EXISTS actioned_signature_data text,
  ADD COLUMN IF NOT EXISTS actioned_signed_at timestamptz;

COMMIT;
