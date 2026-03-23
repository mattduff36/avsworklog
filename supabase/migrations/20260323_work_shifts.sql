CREATE TABLE IF NOT EXISTS public.work_shift_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_shift_templates_name_lower
  ON public.work_shift_templates (LOWER(name));

CREATE UNIQUE INDEX IF NOT EXISTS idx_work_shift_templates_single_default
  ON public.work_shift_templates (is_default)
  WHERE is_default = TRUE;

ALTER TABLE public.work_shift_templates ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at_work_shift_templates ON public.work_shift_templates;
CREATE TRIGGER set_updated_at_work_shift_templates
  BEFORE UPDATE ON public.work_shift_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.work_shift_template_slots (
  template_id UUID NOT NULL REFERENCES public.work_shift_templates(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),
  am_working BOOLEAN NOT NULL DEFAULT FALSE,
  pm_working BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (template_id, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_work_shift_template_slots_template_id
  ON public.work_shift_template_slots (template_id);

ALTER TABLE public.work_shift_template_slots ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at_work_shift_template_slots ON public.work_shift_template_slots;
CREATE TRIGGER set_updated_at_work_shift_template_slots
  BEFORE UPDATE ON public.work_shift_template_slots
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.employee_work_shifts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  template_id UUID NULL REFERENCES public.work_shift_templates(id) ON DELETE SET NULL,
  monday_am BOOLEAN NOT NULL DEFAULT TRUE,
  monday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  tuesday_am BOOLEAN NOT NULL DEFAULT TRUE,
  tuesday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  wednesday_am BOOLEAN NOT NULL DEFAULT TRUE,
  wednesday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  thursday_am BOOLEAN NOT NULL DEFAULT TRUE,
  thursday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  friday_am BOOLEAN NOT NULL DEFAULT TRUE,
  friday_pm BOOLEAN NOT NULL DEFAULT TRUE,
  saturday_am BOOLEAN NOT NULL DEFAULT FALSE,
  saturday_pm BOOLEAN NOT NULL DEFAULT FALSE,
  sunday_am BOOLEAN NOT NULL DEFAULT FALSE,
  sunday_pm BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_work_shifts_template_id
  ON public.employee_work_shifts (template_id);

ALTER TABLE public.employee_work_shifts ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS set_updated_at_employee_work_shifts ON public.employee_work_shifts;
CREATE TRIGGER set_updated_at_employee_work_shifts
  BEFORE UPDATE ON public.employee_work_shifts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

WITH inserted_template AS (
  INSERT INTO public.work_shift_templates (name, description, is_default)
  SELECT 'Standard Week', 'Monday to Friday, AM and PM.', TRUE
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.work_shift_templates
    WHERE LOWER(name) = 'standard week'
  )
  RETURNING id
),
default_template AS (
  SELECT id
  FROM inserted_template
  UNION ALL
  SELECT id
  FROM public.work_shift_templates
  WHERE LOWER(name) = 'standard week'
  LIMIT 1
)
INSERT INTO public.work_shift_template_slots (template_id, day_of_week, am_working, pm_working)
SELECT
  default_template.id,
  slot.day_of_week,
  slot.am_working,
  slot.pm_working
FROM default_template
CROSS JOIN (
  VALUES
    (1, TRUE, TRUE),
    (2, TRUE, TRUE),
    (3, TRUE, TRUE),
    (4, TRUE, TRUE),
    (5, TRUE, TRUE),
    (6, FALSE, FALSE),
    (7, FALSE, FALSE)
) AS slot(day_of_week, am_working, pm_working)
ON CONFLICT (template_id, day_of_week) DO UPDATE
SET
  am_working = EXCLUDED.am_working,
  pm_working = EXCLUDED.pm_working,
  updated_at = NOW();

WITH default_template AS (
  SELECT id
  FROM public.work_shift_templates
  WHERE LOWER(name) = 'standard week'
  ORDER BY created_at ASC
  LIMIT 1
)
INSERT INTO public.employee_work_shifts (
  profile_id,
  template_id,
  monday_am,
  monday_pm,
  tuesday_am,
  tuesday_pm,
  wednesday_am,
  wednesday_pm,
  thursday_am,
  thursday_pm,
  friday_am,
  friday_pm,
  saturday_am,
  saturday_pm,
  sunday_am,
  sunday_pm
)
SELECT
  profiles.id,
  default_template.id,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  FALSE,
  FALSE,
  FALSE,
  FALSE
FROM public.profiles
CROSS JOIN default_template
ON CONFLICT (profile_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.create_default_employee_work_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_default_template_id UUID;
BEGIN
  SELECT id
  INTO v_default_template_id
  FROM public.work_shift_templates
  WHERE is_default = TRUE
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_default_template_id IS NULL THEN
    INSERT INTO public.work_shift_templates (name, description, is_default)
    VALUES ('Standard Week', 'Monday to Friday, AM and PM.', TRUE)
    RETURNING id INTO v_default_template_id;

    INSERT INTO public.work_shift_template_slots (template_id, day_of_week, am_working, pm_working)
    VALUES
      (v_default_template_id, 1, TRUE, TRUE),
      (v_default_template_id, 2, TRUE, TRUE),
      (v_default_template_id, 3, TRUE, TRUE),
      (v_default_template_id, 4, TRUE, TRUE),
      (v_default_template_id, 5, TRUE, TRUE),
      (v_default_template_id, 6, FALSE, FALSE),
      (v_default_template_id, 7, FALSE, FALSE)
    ON CONFLICT (template_id, day_of_week) DO NOTHING;
  END IF;

  INSERT INTO public.employee_work_shifts (
    profile_id,
    template_id
  )
  VALUES (
    NEW.id,
    v_default_template_id
  )
  ON CONFLICT (profile_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS create_default_employee_work_shift_on_profiles ON public.profiles;
CREATE TRIGGER create_default_employee_work_shift_on_profiles
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.create_default_employee_work_shift();
