-- Unify Asset Service Scheduling
-- Adds category↔linked attachments, service rotation steps, per-asset next/last
-- service types, immutable service events, and label snapshots.
-- Legacy Engine/Full HGV custom values and workshop subcategories are retained
-- for rollback/history; presentation switches to a single Service track.

-- Transaction ownership belongs to run-unify-asset-service-scheduling-migration.ts
-- so schema changes and screenshot reconciliation commit atomically.

-- ---------------------------------------------------------------------------
-- 1) maintenance_categories: config keys + workshop category link + km unit
-- ---------------------------------------------------------------------------
ALTER TABLE public.maintenance_categories
  ADD COLUMN IF NOT EXISTS config_key TEXT NULL,
  ADD COLUMN IF NOT EXISTS workshop_category_id UUID NULL
    REFERENCES public.workshop_task_categories(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_categories_config_key
  ON public.maintenance_categories (config_key)
  WHERE config_key IS NOT NULL;

ALTER TABLE public.maintenance_categories
  DROP CONSTRAINT IF EXISTS check_maintenance_categories_period_unit;

ALTER TABLE public.maintenance_categories
  ADD CONSTRAINT check_maintenance_categories_period_unit CHECK (
    (type = 'date' AND period_unit IN ('weeks', 'months'))
    OR (type = 'mileage' AND period_unit IN ('miles', 'km'))
    OR (type = 'hours' AND period_unit = 'hours')
  );

COMMENT ON COLUMN public.maintenance_categories.config_key IS
  'Stable service/config identifier (service_van, service_hgv, service_plant).';
COMMENT ON COLUMN public.maintenance_categories.workshop_category_id IS
  'Optional link from a maintenance service config to its workshop Service category.';

-- ---------------------------------------------------------------------------
-- 2) Category ↔ attachment template links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.workshop_category_attachment_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.workshop_task_categories(id) ON DELETE CASCADE,
  template_id UUID NOT NULL REFERENCES public.workshop_attachment_templates(id) ON DELETE RESTRICT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  compact_label TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT workshop_category_attachment_templates_unique UNIQUE (category_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_wcat_category_id
  ON public.workshop_category_attachment_templates (category_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_wcat_template_id
  ON public.workshop_category_attachment_templates (template_id);

DROP TRIGGER IF EXISTS update_workshop_category_attachment_templates_updated_at
  ON public.workshop_category_attachment_templates;
CREATE TRIGGER update_workshop_category_attachment_templates_updated_at
  BEFORE UPDATE ON public.workshop_category_attachment_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.validate_workshop_category_attachment_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  category_scope TEXT;
  template_scopes TEXT[];
BEGIN
  SELECT applies_to::text INTO category_scope
  FROM public.workshop_task_categories
  WHERE id = NEW.category_id;

  SELECT applies_to INTO template_scopes
  FROM public.workshop_attachment_templates
  WHERE id = NEW.template_id;

  IF category_scope IS NULL THEN
    RAISE EXCEPTION 'Workshop category % not found', NEW.category_id;
  END IF;

  IF template_scopes IS NULL OR cardinality(template_scopes) = 0 THEN
    RAISE EXCEPTION 'Attachment template % has no applies_to scope', NEW.template_id;
  END IF;

  IF NOT (
    category_scope = ANY (template_scopes)
    OR (category_scope = 'van' AND 'vehicle' = ANY (template_scopes))
  ) THEN
    RAISE EXCEPTION
      'Attachment template scope % does not match workshop category scope %',
      template_scopes, category_scope;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_workshop_category_attachment_scope
  ON public.workshop_category_attachment_templates;
CREATE TRIGGER trg_validate_workshop_category_attachment_scope
  BEFORE INSERT OR UPDATE ON public.workshop_category_attachment_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_workshop_category_attachment_scope();

ALTER TABLE public.workshop_category_attachment_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read category attachment links"
  ON public.workshop_category_attachment_templates;
CREATE POLICY "Authenticated users can read category attachment links"
  ON public.workshop_category_attachment_templates
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Managers manage category attachment links"
  ON public.workshop_category_attachment_templates;
CREATE POLICY "Managers manage category attachment links"
  ON public.workshop_category_attachment_templates
  FOR ALL
  TO authenticated
  USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

-- ---------------------------------------------------------------------------
-- 3) Service rotation steps (duplicate template IDs allowed across positions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.service_rotation_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_category_id UUID NOT NULL REFERENCES public.maintenance_categories(id) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position >= 1),
  attachment_template_id UUID NOT NULL REFERENCES public.workshop_attachment_templates(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT service_rotation_steps_position_unique UNIQUE (maintenance_category_id, position)
);

CREATE INDEX IF NOT EXISTS idx_service_rotation_steps_category
  ON public.service_rotation_steps (maintenance_category_id, position);

DROP TRIGGER IF EXISTS update_service_rotation_steps_updated_at
  ON public.service_rotation_steps;
CREATE TRIGGER update_service_rotation_steps_updated_at
  BEFORE UPDATE ON public.service_rotation_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.service_rotation_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can read service rotation steps"
  ON public.service_rotation_steps;
CREATE POLICY "Authenticated users can read service rotation steps"
  ON public.service_rotation_steps
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Managers manage service rotation steps"
  ON public.service_rotation_steps;
CREATE POLICY "Managers manage service rotation steps"
  ON public.service_rotation_steps
  FOR ALL
  TO authenticated
  USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

-- ---------------------------------------------------------------------------
-- 4) Per-asset service type / rotation cursor on vehicle_maintenance
-- ---------------------------------------------------------------------------
ALTER TABLE public.vehicle_maintenance
  ADD COLUMN IF NOT EXISTS last_service_template_id UUID NULL
    REFERENCES public.workshop_attachment_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS next_service_template_id UUID NULL
    REFERENCES public.workshop_attachment_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS next_service_rotation_step_id UUID NULL
    REFERENCES public.service_rotation_steps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vm_next_service_template
  ON public.vehicle_maintenance (next_service_template_id);
CREATE INDEX IF NOT EXISTS idx_vm_last_service_template
  ON public.vehicle_maintenance (last_service_template_id);
CREATE INDEX IF NOT EXISTS idx_vm_next_service_rotation_step
  ON public.vehicle_maintenance (next_service_rotation_step_id);

-- ---------------------------------------------------------------------------
-- 5) Immutable service events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.asset_service_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.actions(id) ON DELETE RESTRICT,
  van_id UUID NULL REFERENCES public.vans(id) ON DELETE CASCADE,
  hgv_id UUID NULL REFERENCES public.hgvs(id) ON DELETE CASCADE,
  plant_id UUID NULL REFERENCES public.plant(id) ON DELETE CASCADE,
  maintenance_category_id UUID NOT NULL REFERENCES public.maintenance_categories(id) ON DELETE RESTRICT,
  completed_template_id UUID NULL REFERENCES public.workshop_attachment_templates(id) ON DELETE RESTRICT,
  completed_template_name TEXT NULL,
  next_template_id UUID NULL REFERENCES public.workshop_attachment_templates(id) ON DELETE RESTRICT,
  next_template_name TEXT NULL,
  completed_rotation_step_id UUID NULL REFERENCES public.service_rotation_steps(id) ON DELETE SET NULL,
  next_rotation_step_id UUID NULL REFERENCES public.service_rotation_steps(id) ON DELETE SET NULL,
  completion_meter INTEGER NOT NULL CHECK (completion_meter >= 0),
  meter_unit TEXT NOT NULL CHECK (meter_unit IN ('miles', 'km', 'hours')),
  interval_value INTEGER NOT NULL CHECK (interval_value > 0),
  interval_unit TEXT NOT NULL CHECK (interval_unit IN ('miles', 'km', 'hours')),
  resulting_due_meter INTEGER NOT NULL CHECK (resulting_due_meter >= 0),
  actor_id UUID NULL REFERENCES public.profiles(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL DEFAULT 'completion'
    CHECK (event_type IN ('completion', 'correction', 'manual_edit')),
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT asset_service_events_one_asset CHECK (
    ((van_id IS NOT NULL)::INTEGER + (hgv_id IS NOT NULL)::INTEGER + (plant_id IS NOT NULL)::INTEGER) = 1
  ),
  CONSTRAINT asset_service_events_task_unique UNIQUE (task_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_service_events_asset_van
  ON public.asset_service_events (van_id) WHERE van_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_service_events_asset_hgv
  ON public.asset_service_events (hgv_id) WHERE hgv_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_asset_service_events_asset_plant
  ON public.asset_service_events (plant_id) WHERE plant_id IS NOT NULL;

ALTER TABLE public.asset_service_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users with maintenance permission read service events"
  ON public.asset_service_events;
CREATE POLICY "Users with maintenance permission read service events"
  ON public.asset_service_events
  FOR SELECT
  TO authenticated
  USING (public.has_maintenance_permission() OR effective_is_manager_admin());

DROP POLICY IF EXISTS "Managers insert service events"
  ON public.asset_service_events;
CREATE POLICY "Managers insert service events"
  ON public.asset_service_events
  FOR INSERT
  TO authenticated
  WITH CHECK (effective_is_manager_admin() OR public.has_maintenance_permission());

-- No UPDATE/DELETE policies: events are append-only via privileged server paths.

-- ---------------------------------------------------------------------------
-- 6) Historical label snapshots
-- ---------------------------------------------------------------------------
ALTER TABLE public.actions
  ADD COLUMN IF NOT EXISTS workshop_category_name_snapshot TEXT NULL,
  ADD COLUMN IF NOT EXISTS workshop_subcategory_name_snapshot TEXT NULL;

ALTER TABLE public.workshop_task_attachments
  ADD COLUMN IF NOT EXISTS template_name_snapshot TEXT NULL;

-- Snapshot category names where category FK is set
UPDATE public.actions a
SET workshop_category_name_snapshot = c.name
FROM public.workshop_task_categories c
WHERE a.workshop_category_id = c.id
  AND a.workshop_category_name_snapshot IS NULL;

-- Snapshot subcategory names (+ parent category when missing) from subcategory FK
UPDATE public.actions a
SET
  workshop_subcategory_name_snapshot = COALESCE(a.workshop_subcategory_name_snapshot, s.name),
  workshop_category_name_snapshot = COALESCE(a.workshop_category_name_snapshot, c.name)
FROM public.workshop_task_subcategories s
JOIN public.workshop_task_categories c ON c.id = s.category_id
WHERE a.workshop_subcategory_id = s.id
  AND (
    a.workshop_subcategory_name_snapshot IS NULL
    OR a.workshop_category_name_snapshot IS NULL
  );

UPDATE public.workshop_task_attachments a
SET template_name_snapshot = COALESCE(a.template_name_snapshot, t.name)
FROM public.workshop_attachment_templates t
WHERE a.template_id = t.id
  AND a.template_name_snapshot IS NULL;

-- ---------------------------------------------------------------------------
-- 7) Normalize Van Service template scope vehicle → van
-- ---------------------------------------------------------------------------
UPDATE public.workshop_attachment_templates
SET applies_to = ARRAY['van']::TEXT[]
WHERE LOWER(name) = 'van service'
  AND applies_to @> ARRAY['vehicle']::TEXT[];

-- ---------------------------------------------------------------------------
-- 8) Deactivate workshop subcategories (preserve rows + FKs)
-- ---------------------------------------------------------------------------
UPDATE public.workshop_task_categories
SET requires_subcategories = FALSE
WHERE requires_subcategories = TRUE;

UPDATE public.workshop_task_subcategories
SET is_active = FALSE
WHERE is_active = TRUE;

-- Remove write policies for subcategories (reads remain for history)
DROP POLICY IF EXISTS "Managers can insert workshop task subcategories"
  ON public.workshop_task_subcategories;
DROP POLICY IF EXISTS "Managers can update workshop task subcategories"
  ON public.workshop_task_subcategories;
DROP POLICY IF EXISTS "Managers can delete workshop task subcategories"
  ON public.workshop_task_subcategories;
DROP POLICY IF EXISTS "Managers manage workshop task subcategories"
  ON public.workshop_task_subcategories;

-- ---------------------------------------------------------------------------
-- 9) Seed category ↔ template links
-- ---------------------------------------------------------------------------
WITH mapping(category_name, category_scope, template_name, sort_order, compact_label) AS (
  VALUES
    ('Service (HGV)', 'hgv', 'Basic Service A (HGV)', 1, 'Basic A'),
    ('Service (HGV)', 'hgv', 'Basic Service B (HGV)', 2, 'Basic B'),
    ('Service (HGV)', 'hgv', 'Full Service (HGV)', 3, 'Full'),
    ('6 weekly inspection (HGV)', 'hgv', '6 Week Inspection - HGV', 1, NULL),
    ('6 weekly inspection (HGV)', 'hgv', '6 Week Inspection - Trailer', 2, NULL),
    ('Service (Plant)', 'plant', 'Plant Service / Inspection', 1, NULL),
    ('LOLER', 'plant', 'LOLER THOROUGH EXAMINATION', 1, NULL),
    ('Service (Van)', 'van', 'Van Service', 1, NULL)
)
INSERT INTO public.workshop_category_attachment_templates (
  category_id, template_id, sort_order, compact_label
)
SELECT c.id, t.id, m.sort_order, m.compact_label
FROM mapping m
JOIN public.workshop_task_categories c
  ON LOWER(c.name) = LOWER(m.category_name)
 AND c.applies_to::text = m.category_scope
JOIN public.workshop_attachment_templates t
  ON LOWER(t.name) = LOWER(m.template_name)
ON CONFLICT (category_id, template_id) DO UPDATE
SET
  sort_order = EXCLUDED.sort_order,
  compact_label = COALESCE(EXCLUDED.compact_label, workshop_category_attachment_templates.compact_label),
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 10) Promote Engine Service → HGV Service system field; deactivate Full Service
-- ---------------------------------------------------------------------------
UPDATE public.maintenance_categories
SET
  name = 'Service',
  description = COALESCE(description, 'HGV service due mileage (unified Basic A/B/Full rotation)'),
  field_key = 'next_service_mileage',
  is_system = TRUE,
  is_delete_protected = TRUE,
  period_value = 25000,
  period_unit = 'km',
  alert_threshold_miles = COALESCE(alert_threshold_miles, 2500),
  applies_to = ARRAY['hgv']::TEXT[],
  config_key = 'service_hgv',
  workshop_category_id = (
    SELECT id FROM public.workshop_task_categories
    WHERE LOWER(name) = 'service (hgv)' AND applies_to::text = 'hgv'
    LIMIT 1
  ),
  show_on_overview = TRUE,
  is_active = TRUE
WHERE LOWER(name) = 'engine service'
  AND 'hgv' = ANY (applies_to);

UPDATE public.maintenance_categories
SET
  is_active = FALSE,
  show_on_overview = FALSE,
  config_key = 'legacy_full_service_hgv'
WHERE LOWER(name) = 'full service'
  AND 'hgv' = ANY (applies_to);

UPDATE public.maintenance_categories
SET
  config_key = 'service_van',
  workshop_category_id = (
    SELECT id FROM public.workshop_task_categories
    WHERE LOWER(name) = 'service (van)' AND applies_to::text = 'van'
    LIMIT 1
  ),
  period_value = COALESCE(period_value, 10000),
  period_unit = 'miles'
WHERE LOWER(name) = 'service due'
  AND 'van' = ANY (applies_to);

UPDATE public.maintenance_categories
SET
  config_key = 'service_plant',
  workshop_category_id = (
    SELECT id FROM public.workshop_task_categories
    WHERE LOWER(name) = 'service (plant)' AND applies_to::text = 'plant'
    LIMIT 1
  ),
  period_value = COALESCE(period_value, 250),
  period_unit = 'hours'
WHERE LOWER(name) = 'service due (hours)'
  AND 'plant' = ANY (applies_to);

-- ---------------------------------------------------------------------------
-- 11) Seed default rotations
-- ---------------------------------------------------------------------------
-- HGV: Basic A → Basic B → Basic A → Full
WITH hgv_service AS (
  SELECT id FROM public.maintenance_categories WHERE config_key = 'service_hgv' LIMIT 1
),
templates AS (
  SELECT name, id FROM public.workshop_attachment_templates
  WHERE LOWER(name) IN (
    LOWER('Basic Service A (HGV)'),
    LOWER('Basic Service B (HGV)'),
    LOWER('Full Service (HGV)')
  )
),
steps(position, template_name) AS (
  VALUES
    (1, 'Basic Service A (HGV)'),
    (2, 'Basic Service B (HGV)'),
    (3, 'Basic Service A (HGV)'),
    (4, 'Full Service (HGV)')
)
INSERT INTO public.service_rotation_steps (maintenance_category_id, position, attachment_template_id)
SELECT hs.id, s.position, t.id
FROM hgv_service hs
CROSS JOIN steps s
JOIN templates t ON LOWER(t.name) = LOWER(s.template_name)
ON CONFLICT (maintenance_category_id, position) DO UPDATE
SET attachment_template_id = EXCLUDED.attachment_template_id, updated_at = NOW();

-- Van: single Van Service step
INSERT INTO public.service_rotation_steps (maintenance_category_id, position, attachment_template_id)
SELECT mc.id, 1, t.id
FROM public.maintenance_categories mc
JOIN public.workshop_attachment_templates t ON LOWER(t.name) = 'van service'
WHERE mc.config_key = 'service_van'
ON CONFLICT (maintenance_category_id, position) DO UPDATE
SET attachment_template_id = EXCLUDED.attachment_template_id, updated_at = NOW();

-- Plant: single Plant Service / Inspection step
INSERT INTO public.service_rotation_steps (maintenance_category_id, position, attachment_template_id)
SELECT mc.id, 1, t.id
FROM public.maintenance_categories mc
JOIN public.workshop_attachment_templates t ON LOWER(t.name) = 'plant service / inspection'
WHERE mc.config_key = 'service_plant'
ON CONFLICT (maintenance_category_id, position) DO UPDATE
SET attachment_template_id = EXCLUDED.attachment_template_id, updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 12) Copy Engine Service custom dues into vehicle_maintenance.next_service_mileage
--     (keeps legacy custom rows for rollback)
-- ---------------------------------------------------------------------------
UPDATE public.vehicle_maintenance vm
SET
  next_service_mileage = COALESCE(vm.next_service_mileage, cv.due_mileage),
  last_service_mileage = COALESCE(vm.last_service_mileage, cv.last_mileage),
  updated_at = NOW()
FROM public.asset_maintenance_category_values cv
JOIN public.maintenance_categories mc ON mc.id = cv.maintenance_category_id
WHERE cv.hgv_id = vm.hgv_id
  AND mc.config_key = 'service_hgv'
  AND NOT EXISTS (
    SELECT 1
    FROM public.asset_service_events e
    WHERE e.hgv_id = vm.hgv_id
      AND e.event_type = 'completion'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.hgvs h
    WHERE h.id = vm.hgv_id
      AND (
        UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = 'TE57HGV'
        OR LOWER(COALESCE(h.nickname, '')) = 'test-hgv'
      )
  )
  AND (cv.due_mileage IS NOT NULL OR cv.last_mileage IS NOT NULL);

