-- Debug console access is allow-listed (super admin / Charlotte).
-- Disable the sensitive PIN requirement for the hidden debug module.

UPDATE public.permission_modules
SET
  requires_sensitive_pin = FALSE,
  updated_at = NOW()
WHERE module_name = 'debug';
