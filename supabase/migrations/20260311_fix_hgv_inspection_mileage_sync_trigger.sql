-- Ensure inspection mileage sync covers van, HGV, and plant tables.
-- This fixes HGV inspections not updating vehicle_maintenance.current_mileage,
-- which drives fleet and history mileage displays.

CREATE OR REPLACE FUNCTION update_vehicle_maintenance_mileage()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_TABLE_NAME = 'van_inspections' THEN
    IF NEW.van_id IS NULL OR NEW.current_mileage IS NULL THEN
      RETURN NEW;
    END IF;

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

  ELSIF TG_TABLE_NAME = 'hgv_inspections' THEN
    IF NEW.hgv_id IS NULL OR NEW.current_mileage IS NULL THEN
      RETURN NEW;
    END IF;

    UPDATE vehicle_maintenance
    SET
      current_mileage = NEW.current_mileage,
      last_mileage_update = NOW(),
      updated_at = NOW()
    WHERE hgv_id = NEW.hgv_id;

    IF NOT FOUND THEN
      INSERT INTO vehicle_maintenance (hgv_id, current_mileage, last_mileage_update)
      VALUES (NEW.hgv_id, NEW.current_mileage, NOW());
    END IF;

  ELSIF TG_TABLE_NAME = 'plant_inspections' THEN
    IF NEW.plant_id IS NULL OR NEW.current_mileage IS NULL THEN
      RETURN NEW;
    END IF;

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

-- Keep van trigger aligned with the latest shared function.
DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage ON van_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage
AFTER INSERT OR UPDATE OF current_mileage
ON van_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_vehicle_maintenance_mileage();

-- Ensure plant inspections also feed maintenance hours.
DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage_plant ON plant_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage_plant
AFTER INSERT OR UPDATE OF current_mileage
ON plant_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_vehicle_maintenance_mileage();

-- Add missing HGV mileage sync trigger.
DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage_hgv ON hgv_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage_hgv
AFTER INSERT OR UPDATE OF current_mileage
ON hgv_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_vehicle_maintenance_mileage();
