BEGIN;

CREATE TABLE IF NOT EXISTS absence_allowance_carryovers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  financial_year_start_year INTEGER NOT NULL,
  source_financial_year_start_year INTEGER NOT NULL,
  carried_days NUMERIC(6,2) NOT NULL DEFAULT 0,
  auto_generated BOOLEAN NOT NULL DEFAULT true,
  generation_source TEXT NOT NULL DEFAULT 'absence-year-end-carryover',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  generated_by UUID NULL REFERENCES profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT absence_allowance_carryovers_profile_year_key UNIQUE (profile_id, financial_year_start_year),
  CONSTRAINT absence_allowance_carryovers_non_negative CHECK (carried_days >= 0),
  CONSTRAINT absence_allowance_carryovers_distinct_years CHECK (financial_year_start_year > source_financial_year_start_year)
);

CREATE INDEX IF NOT EXISTS idx_absence_allowance_carryovers_year
  ON absence_allowance_carryovers (financial_year_start_year DESC);

CREATE INDEX IF NOT EXISTS idx_absence_allowance_carryovers_profile
  ON absence_allowance_carryovers (profile_id);

ALTER TABLE absence_allowance_carryovers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own absence carryovers" ON absence_allowance_carryovers;
CREATE POLICY "Users can view own absence carryovers" ON absence_allowance_carryovers
FOR SELECT TO authenticated
USING (auth.uid() = profile_id);

DROP POLICY IF EXISTS "Managers can view all absence carryovers" ON absence_allowance_carryovers;
CREATE POLICY "Managers can view all absence carryovers" ON absence_allowance_carryovers
FOR SELECT TO authenticated
USING (effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers can manage absence carryovers" ON absence_allowance_carryovers;
CREATE POLICY "Managers can manage absence carryovers" ON absence_allowance_carryovers
FOR ALL TO authenticated
USING (effective_is_manager_admin())
WITH CHECK (effective_is_manager_admin());

DROP TRIGGER IF EXISTS set_updated_at_absence_allowance_carryovers ON absence_allowance_carryovers;
CREATE TRIGGER set_updated_at_absence_allowance_carryovers
  BEFORE UPDATE ON absence_allowance_carryovers
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();

GRANT ALL ON absence_allowance_carryovers TO authenticated;

COMMIT;
