-- Partial unique index to prevent duplicate daily plant inspections
-- Only enforced where plant_id is populated (plant inspections, not vehicle inspections)
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_plant_inspection_date
  ON vehicle_inspections (plant_id, inspection_date)
  WHERE plant_id IS NOT NULL;
