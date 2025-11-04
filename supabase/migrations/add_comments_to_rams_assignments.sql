-- Add comments column to rams_assignments table
ALTER TABLE rams_assignments 
ADD COLUMN IF NOT EXISTS comments TEXT;

-- Add comment for documentation
COMMENT ON COLUMN rams_assignments.comments IS 'Optional comments from employee when signing the RAMS document';

