-- Fix update_vehicle_maintenance_mileage() trigger to handle plant inspections
-- Previously, the trigger only handled vehicle_id. When a plant inspection was saved
-- (vehicle_id = NULL, plant_id set), the INSERT would violate check_maintenance_asset.

CREATE OR REPLACE FUNCTION update_vehicle_maintenance_mileage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.vehicle_id IS NOT NULL THEN
    UPDATE vehicle_maintenance
    SET 
      current_mileage = NEW.current_mileage,
      last_mileage_update = NOW(),
      updated_at = NOW()
    WHERE vehicle_id = NEW.vehicle_id;

    IF NOT FOUND THEN
      INSERT INTO vehicle_maintenance (vehicle_id, current_mileage, last_mileage_update)
      VALUES (NEW.vehicle_id, NEW.current_mileage, NOW());
    END IF;

  ELSIF NEW.plant_id IS NOT NULL THEN
    UPDATE vehicle_maintenance
    SET 
      current_hours = NEW.current_mileage,
      last_hours_update = NOW(),
      updated_at = NOW()
    WHERE plant_id = NEW.plant_id;

    IF NOT FOUND THEN
      INSERT INTO vehicle_maintenance (plant_id, current_hours, last_hours_update)
      VALUES (NEW.plant_id, NEW.current_mileage, NOW());
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
