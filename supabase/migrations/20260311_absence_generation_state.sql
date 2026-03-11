BEGIN;

CREATE TABLE IF NOT EXISTS absence_financial_year_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  financial_year_start_year INTEGER NOT NULL UNIQUE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_absence_financial_year_generations_start_year
ON absence_financial_year_generations (financial_year_start_year DESC);

ALTER TABLE absence_financial_year_generations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view absence generation state" ON absence_financial_year_generations;
CREATE POLICY "Authenticated can view absence generation state" ON absence_financial_year_generations
FOR SELECT TO authenticated
USING (true);

DROP POLICY IF EXISTS "Managers can create absence generation state" ON absence_financial_year_generations;
CREATE POLICY "Managers can create absence generation state" ON absence_financial_year_generations
FOR INSERT TO authenticated
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can update absence generation state" ON absence_financial_year_generations;
CREATE POLICY "Managers can update absence generation state" ON absence_financial_year_generations
FOR UPDATE TO authenticated
USING (effective_is_manager_admin())
WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can delete absence generation state" ON absence_financial_year_generations;
CREATE POLICY "Managers can delete absence generation state" ON absence_financial_year_generations
FOR DELETE TO authenticated
USING (effective_is_manager_admin());

DROP TRIGGER IF EXISTS set_updated_at_absence_financial_year_generations ON absence_financial_year_generations;
CREATE TRIGGER set_updated_at_absence_financial_year_generations
  BEFORE UPDATE ON absence_financial_year_generations
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

COMMIT;
