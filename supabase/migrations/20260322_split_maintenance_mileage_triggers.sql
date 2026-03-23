BEGIN;

CREATE OR REPLACE FUNCTION update_van_maintenance_mileage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_hgv_maintenance_mileage()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION update_plant_maintenance_hours()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage ON van_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage
AFTER INSERT OR UPDATE OF current_mileage
ON van_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_van_maintenance_mileage();

DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage_plant ON plant_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage_plant
AFTER INSERT OR UPDATE OF current_mileage
ON plant_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_plant_maintenance_hours();

DROP TRIGGER IF EXISTS trigger_update_maintenance_mileage_hgv ON hgv_inspections;
CREATE TRIGGER trigger_update_maintenance_mileage_hgv
AFTER INSERT OR UPDATE OF current_mileage
ON hgv_inspections
FOR EACH ROW
WHEN (NEW.current_mileage IS NOT NULL)
EXECUTE FUNCTION update_hgv_maintenance_mileage();

DROP FUNCTION IF EXISTS update_vehicle_maintenance_mileage();

COMMIT;
