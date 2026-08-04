-- Down migration: reverse Basic Service A/B clone retirement
-- Reactivates original and deactivates A/B. Does not delete templates that may have attachments.

BEGIN;

UPDATE public.workshop_attachment_templates
SET is_active = true,
    updated_at = NOW()
WHERE LOWER(name) = LOWER('Basic Service (HGV)');

UPDATE public.workshop_attachment_templates
SET is_active = false,
    updated_at = NOW()
WHERE LOWER(name) IN (
  LOWER('Basic Service A (HGV)'),
  LOWER('Basic Service B (HGV)')
);

COMMIT;
