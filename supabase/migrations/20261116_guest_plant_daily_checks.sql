-- finalise-phase: predeploy
BEGIN;
CREATE TABLE private.guest_plant_settings (
 id boolean PRIMARY KEY DEFAULT true CHECK (id), enabled boolean NOT NULL DEFAULT false,
 qr_secret text NOT NULL, generation integer NOT NULL DEFAULT 1,
 owner_id uuid REFERENCES public.profiles(id), updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid REFERENCES public.profiles(id)
);
INSERT INTO private.guest_plant_settings(id, qr_secret) VALUES (true, encode(gen_random_bytes(32), 'hex'));
DO $$ DECLARE v_owner uuid := gen_random_uuid(); BEGIN
 PERFORM set_config('app.system_account_maintenance', 'on', true);
 INSERT INTO auth.users(id, aud, role, email, encrypted_password, banned_until, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
 VALUES(v_owner, 'authenticated', 'authenticated', 'guest-plant-' || v_owner || '@system.invalid', '', 'infinity',
  '{"full_name":"Temporary Plant Checks"}'::jsonb, '{}'::jsonb, now(), now());
 INSERT INTO public.profiles(id, full_name, role, team_id, is_system_account, annual_holiday_allowance_days)
 VALUES(v_owner, 'Temporary Plant Checks', 'employee', 'system_accounts', true, 0)
 ON CONFLICT(id) DO UPDATE SET full_name = EXCLUDED.full_name, role = 'employee', role_id = NULL,
  team_id = 'system_accounts', is_system_account = true, annual_holiday_allowance_days = 0, super_admin = false;
 UPDATE private.guest_plant_settings SET owner_id = v_owner;
 -- Signup creates a default employee shift before the identity is marked as a system account.
 DELETE FROM public.employee_work_shifts WHERE profile_id = v_owner;
END; $$;
CREATE TABLE private.guest_plant_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE, generation integer NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT (now() + interval '4 hours'), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.guest_plant_requests (
 session_id uuid NOT NULL REFERENCES private.guest_plant_sessions(id), request_id uuid NOT NULL,
 payload_hash text NOT NULL, inspection_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(session_id, request_id)
);
CREATE TABLE private.guest_plant_uploads (
 id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES private.guest_plant_sessions(id), request_id uuid NOT NULL,
 item_number integer NOT NULL CHECK (item_number BETWEEN 1 AND 23), object_key text NOT NULL UNIQUE,
 photo_url text NOT NULL, content_hash text NOT NULL, claimed boolean NOT NULL DEFAULT false, ready boolean NOT NULL DEFAULT false, abandoned boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE private.guest_plant_rate_limits (
 key text PRIMARY KEY, window_start timestamptz NOT NULL, attempts integer NOT NULL
);
ALTER TABLE private.guest_plant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.guest_plant_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.guest_plant_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.guest_plant_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.guest_plant_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.guest_plant_settings, private.guest_plant_sessions, private.guest_plant_requests, private.guest_plant_uploads, private.guest_plant_rate_limits FROM PUBLIC, anon, authenticated;

ALTER TABLE public.plant_inspections ADD COLUMN guest_name text,
 ADD COLUMN guest_submission_id uuid UNIQUE;
ALTER TABLE public.plant_inspections ADD CONSTRAINT plant_guest_attribution CHECK (
 (guest_name IS NULL AND guest_submission_id IS NULL) OR
 (guest_name IS NOT NULL AND length(btrim(guest_name)) BETWEEN 2 AND 100 AND guest_submission_id IS NOT NULL AND plant_id IS NOT NULL AND is_hired_plant = false)
);
DROP INDEX public.idx_unique_plant_inspection_user_date;
CREATE UNIQUE INDEX idx_unique_plant_inspection_user_date ON public.plant_inspections(plant_id, user_id, inspection_date)
 WHERE plant_id IS NOT NULL AND guest_submission_id IS NULL;

CREATE FUNCTION private.guard_guest_plant_attribution() RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
 IF TG_OP = 'UPDATE' AND (NEW.guest_name IS DISTINCT FROM OLD.guest_name OR NEW.guest_submission_id IS DISTINCT FROM OLD.guest_submission_id) THEN
  RAISE EXCEPTION 'Guest attribution is immutable';
 END IF;
 IF NEW.guest_submission_id IS NOT NULL THEN
  IF NOT EXISTS (SELECT 1 FROM private.guest_plant_settings WHERE owner_id = NEW.user_id) THEN RAISE EXCEPTION 'Guest owner mismatch'; END IF;
  IF TG_OP = 'INSERT' AND current_user IN ('authenticated', 'anon') THEN RAISE EXCEPTION 'Guest submission requires the guest service'; END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guard_guest_plant_attribution BEFORE INSERT OR UPDATE ON public.plant_inspections FOR EACH ROW EXECUTE FUNCTION private.guard_guest_plant_attribution();
REVOKE ALL ON FUNCTION private.guard_guest_plant_attribution() FROM PUBLIC, anon, authenticated;

CREATE POLICY "Managers and supervisors read guest plant checks" ON public.plant_inspections FOR SELECT TO authenticated USING (
 guest_submission_id IS NOT NULL AND effective_has_module_permission('plant-inspections')
 AND (effective_is_manager_admin() OR effective_is_supervisor())
);
-- Existing broad legacy policies must not bypass the module gate for guest rows or their evidence.
CREATE FUNCTION public.can_read_guest_plant_inspection(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.plant_inspections WHERE id = p_id AND guest_submission_id IS NOT NULL)
 OR (auth.uid() IS NOT NULL AND effective_has_module_permission('plant-inspections') AND
   (effective_is_manager_admin() OR effective_is_supervisor() OR effective_is_workshop_team()));
$$;
REVOKE ALL ON FUNCTION public.can_read_guest_plant_inspection(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_guest_plant_inspection(uuid) TO authenticated;
CREATE POLICY "Guest plant module read boundary" ON public.plant_inspections AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.can_read_guest_plant_inspection(id));
CREATE POLICY "Guest plant items read boundary" ON public.inspection_items AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.can_read_guest_plant_inspection(inspection_id));
CREATE POLICY "Guest plant photos read boundary" ON public.inspection_photos AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.can_read_guest_plant_inspection(inspection_id));
CREATE POLICY "Guest plant hours read boundary" ON public.inspection_daily_hours AS RESTRICTIVE FOR SELECT TO authenticated
 USING (public.can_read_guest_plant_inspection(inspection_id));
COMMIT;
