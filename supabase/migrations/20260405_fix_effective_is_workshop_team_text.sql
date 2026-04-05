BEGIN;

CREATE OR REPLACE FUNCTION public.effective_is_workshop_team()
RETURNS BOOLEAN AS $$
DECLARE
  eff_team_id TEXT;
BEGIN
  eff_team_id := effective_team_id();

  IF eff_team_id IS NULL OR eff_team_id = '' THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM org_teams
    WHERE id = eff_team_id
      AND lower(name) = 'workshop'
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER
   SET search_path = public, pg_temp;

COMMIT;
