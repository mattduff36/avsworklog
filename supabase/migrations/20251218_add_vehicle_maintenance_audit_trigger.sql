-- Add audit logging trigger for vehicle_maintenance table
-- This was missing from the initial audit logging setup

-- Drop existing trigger if it exists
DROP TRIGGER IF EXISTS audit_vehicle_maintenance ON vehicle_maintenance;

-- Create trigger for vehicle_maintenance
CREATE TRIGGER audit_vehicle_maintenance
  AFTER INSERT OR UPDATE OR DELETE ON vehicle_maintenance
  FOR EACH ROW EXECUTE FUNCTION log_audit_changes();

-- Verify trigger was created
SELECT 
  trigger_name, 
  event_manipulation, 
  event_object_table
FROM information_schema.triggers 
WHERE event_object_table = 'vehicle_maintenance';

SELECT 'Audit trigger for vehicle_maintenance created successfully! ✅' as status;
