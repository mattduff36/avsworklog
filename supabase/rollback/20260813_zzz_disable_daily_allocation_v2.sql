-- DA2-ROLL-001: disable-and-forward-fix for Daily Allocation v2.
-- Preserves v1 and v2 tables, publications, snapshots, messages, and plan days.
-- This path only disables the module and v2 runtime flags. It does not destroy
-- data, rewrite publication versions, infer end times, or reopen converted
-- team/date v1 writes.
BEGIN;

UPDATE public.team_module_permissions
SET enabled = FALSE,
    updated_at = NOW()
WHERE module_name = 'daily-allocation';

UPDATE private.daily_allocation_v2_runtime
SET board_enabled = FALSE,
    writes_enabled = FALSE,
    updated_at = NOW()
WHERE singleton = TRUE;

COMMIT;
