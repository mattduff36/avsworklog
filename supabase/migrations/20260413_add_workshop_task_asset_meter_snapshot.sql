-- Store the asset meter reading entered on a workshop task so attachment PDFs
-- can show the task-specific mileage / KM / hours in their Details header.
-- PRD alignment: docs/PRD_WORKSHOP_TASKS.md + plans/feature-05-workshop-attachments.md

ALTER TABLE actions
ADD COLUMN IF NOT EXISTS asset_meter_reading INTEGER;

ALTER TABLE actions
ADD COLUMN IF NOT EXISTS asset_meter_unit TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'actions_asset_meter_unit_check'
  ) THEN
    ALTER TABLE actions
    ADD CONSTRAINT actions_asset_meter_unit_check
    CHECK (asset_meter_unit IS NULL OR asset_meter_unit IN ('miles', 'km', 'hours'));
  END IF;
END $$;

UPDATE actions
SET asset_meter_unit = CASE
  WHEN plant_id IS NOT NULL THEN 'hours'
  WHEN hgv_id IS NOT NULL THEN 'km'
  WHEN van_id IS NOT NULL THEN 'miles'
  ELSE asset_meter_unit
END
WHERE action_type IN ('inspection_defect', 'workshop_vehicle_task')
  AND asset_meter_unit IS NULL;

UPDATE actions AS a
SET asset_meter_reading = vm.current_hours
FROM vehicle_maintenance AS vm
WHERE a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
  AND a.asset_meter_reading IS NULL
  AND a.plant_id IS NOT NULL
  AND vm.plant_id = a.plant_id;

UPDATE actions AS a
SET asset_meter_reading = vm.current_mileage
FROM vehicle_maintenance AS vm
WHERE a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
  AND a.asset_meter_reading IS NULL
  AND a.hgv_id IS NOT NULL
  AND vm.hgv_id = a.hgv_id;

UPDATE actions AS a
SET asset_meter_reading = vm.current_mileage
FROM vehicle_maintenance AS vm
WHERE a.action_type IN ('inspection_defect', 'workshop_vehicle_task')
  AND a.asset_meter_reading IS NULL
  AND a.van_id IS NOT NULL
  AND vm.van_id = a.van_id;

COMMENT ON COLUMN actions.asset_meter_reading IS 'Task-level asset meter snapshot captured when the workshop task was created or edited.';
COMMENT ON COLUMN actions.asset_meter_unit IS 'Unit for asset_meter_reading: miles, km, or hours.';
