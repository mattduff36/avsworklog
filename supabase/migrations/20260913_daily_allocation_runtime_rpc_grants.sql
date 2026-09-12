-- finalise-phase: predeploy
-- Align get_daily_allocation_v2_runtime with the activation grant contract.
-- The 20260912 file was already applied; do not edit that shipped checksum.
BEGIN;

REVOKE ALL ON FUNCTION public.get_daily_allocation_v2_runtime() FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_daily_allocation_v2_runtime() TO authenticated;

COMMIT;
