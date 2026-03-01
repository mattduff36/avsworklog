-- Fix update_vehicle_maintenance_mileage() after vehicle_id → van_id rename
-- The big-bang rename (20260302_big_bang_vehicle_to_van_rename) renamed the
-- vehicle_id column in van_inspections to van_id, but the trigger function
-- still references NEW.vehicle_id and vehicle_maintenance.vehicle_id.
-- This causes "record new has no field vehicle_id" on every inspection save.

CREATE OR REPLACE FUNCTION update_vehicle_maintenance_mileage()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.van_id IS NOT NULL THEN
    UPDATE vehicle_maintenance
    SET
      current_mileage = NEW.current_mileage,
      last_mileage_update = NOW(),
      updated_at = NOW()
    WHERE van_id = NEW.van_id;

    IF NOT FOUND THEN
      INSERT INTO vehicle_maintenance (van_id, current_mileage, last_mileage_update)
      VALUES (NEW.van_id, NEW.current_mileage, NOW());
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
