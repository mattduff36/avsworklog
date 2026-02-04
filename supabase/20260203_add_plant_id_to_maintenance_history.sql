-- Add plant_id column to maintenance_history table to support plant maintenance audit trail
-- This allows tracking maintenance changes for both vehicles and plant machinery

-- Add plant_id column (nullable, since existing records are for vehicles only)
DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name='maintenance_history' AND column_name='plant_id'
  ) THEN
    ALTER TABLE maintenance_history ADD COLUMN plant_id UUID REFERENCES plant(id) ON DELETE CASCADE;
    
    -- Add index for plant_id lookups
    CREATE INDEX IF NOT EXISTS idx_maintenance_history_plant_id ON maintenance_history(plant_id);
    
    -- Add a check constraint to ensure either vehicle_id or plant_id is set (but not both)
    ALTER TABLE maintenance_history 
    ADD CONSTRAINT check_vehicle_or_plant 
    CHECK (
      (vehicle_id IS NOT NULL AND plant_id IS NULL) OR 
      (vehicle_id IS NULL AND plant_id IS NOT NULL)
    );
  END IF;
END $$;
