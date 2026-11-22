-- Publish the Plant Daily Check schema for the optional workshop attachment.
-- Enable the template in Workshop Tasks settings after the app release is live.
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.workshop_category_attachment_templates
  ADD COLUMN is_required boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.workshop_category_attachment_templates.is_required IS
  'Whether a task needs a linked attachment during creation.';

DO $migration$
DECLARE
  target_category_id uuid;
  new_template_id uuid;
  new_version_id uuid;
  new_section_id uuid;
BEGIN
  SELECT id INTO STRICT target_category_id
  FROM public.workshop_task_categories
  WHERE name = 'General inspection (Plant)' AND applies_to = 'plant' AND is_active
  FOR UPDATE;

  IF EXISTS (
    SELECT 1 FROM public.maintenance_categories
    WHERE workshop_category_id = target_category_id
  ) OR EXISTS (
    SELECT 1 FROM public.workshop_category_attachment_templates
    WHERE category_id = target_category_id
  ) THEN
    RAISE EXCEPTION 'General inspection (Plant) already has a service configuration or attachment link';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.workshop_attachment_templates
    WHERE lower(name) = 'plant daily check'
  ) THEN
    RAISE EXCEPTION 'A Plant Daily Check workshop attachment template already exists';
  END IF;

  INSERT INTO public.workshop_attachment_templates (name, description, is_active, applies_to)
  VALUES ('Plant Daily Check', 'Checklist for General inspection (Plant) workshop tasks.', false, ARRAY['plant'])
  RETURNING id INTO new_template_id;

  INSERT INTO public.workshop_attachment_template_versions (template_id, version_number, status)
  VALUES (new_template_id, 1, 'published')
  RETURNING id INTO new_version_id;

  INSERT INTO public.workshop_attachment_template_sections (version_id, section_key, title, sort_order)
  VALUES (new_version_id, 'plant_daily_check', 'Plant Daily Check', 1)
  RETURNING id INTO new_section_id;

  INSERT INTO public.workshop_attachment_template_fields (
    section_id, field_key, label, field_type, is_required, sort_order, validation_json
  )
  SELECT new_section_id, 'check_' || position, label, 'marking_code', true, position,
         '{"require_note_for":["attention"]}'::jsonb
  FROM (VALUES
    (1, 'Oil, fuel & coolant levels/leaks'),
    (2, 'Wheels & nuts'),
    (3, 'Tyres/Tracks'),
    (4, 'Windows & Wipers'),
    (5, 'Mirrors'),
    (6, 'Steps & Handrails'),
    (7, 'Lights/Flashing Beacons'),
    (8, 'Instrument Gauges/Horns'),
    (9, 'Seat Belt'),
    (10, 'Fire Extinguisher'),
    (11, 'TV Camera'),
    (12, 'Body-Up Buzzer'),
    (13, 'Steering'),
    (14, 'Reverse Alarm'),
    (15, 'Parking Brake'),
    (16, 'Brake Test'),
    (17, 'Hoses/Overload Devices'),
    (18, 'Lifting Attachments'),
    (19, 'Lift & Crowd Operation'),
    (20, 'Blade/Bucket'),
    (21, 'Spill Kit'),
    (22, 'Greased'),
    (23, 'Transmission')
  ) AS item(position, label);

  INSERT INTO public.workshop_category_attachment_templates (category_id, template_id, is_required)
  VALUES (target_category_id, new_template_id, false);
END;
$migration$;

COMMIT;
