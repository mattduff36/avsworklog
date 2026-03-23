CREATE TABLE IF NOT EXISTS public.absence_module_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  announcement_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.absence_module_settings ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at_absence_module_settings ON public.absence_module_settings;
CREATE TRIGGER set_updated_at_absence_module_settings
  BEFORE UPDATE ON public.absence_module_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP POLICY IF EXISTS "Authenticated can view absence module settings" ON public.absence_module_settings;
CREATE POLICY "Authenticated can view absence module settings" ON public.absence_module_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "Admins can insert absence module settings" ON public.absence_module_settings;
CREATE POLICY "Admins can insert absence module settings" ON public.absence_module_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (is_actor_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can update absence module settings" ON public.absence_module_settings;
CREATE POLICY "Admins can update absence module settings" ON public.absence_module_settings
  FOR UPDATE
  TO authenticated
  USING (is_actor_admin(auth.uid()))
  WITH CHECK (is_actor_admin(auth.uid()));

DROP POLICY IF EXISTS "Admins can delete absence module settings" ON public.absence_module_settings;
CREATE POLICY "Admins can delete absence module settings" ON public.absence_module_settings
  FOR DELETE
  TO authenticated
  USING (is_actor_admin(auth.uid()));

INSERT INTO public.absence_module_settings (id, announcement_message)
VALUES (TRUE, NULL)
ON CONFLICT (id) DO NOTHING;
