BEGIN;

REVOKE ALL ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) FROM authenticated;

REVOKE ALL ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) FROM authenticated;

REVOKE ALL ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) FROM anon;
REVOKE ALL ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.clear_fleet_assignment_for_asset(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_fleet_inventory_location(TEXT, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_apply_fleet_asset_nickname_assignment(TEXT, UUID, TEXT, TEXT, UUID, UUID, UUID) TO service_role;

COMMIT;
