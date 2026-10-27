-- finalise-phase: predeploy
-- Publish Basic Service A (Van) from the latest published Van Service checklist,
-- keep that same template row as Full Service (Van), and rotate service_van
-- Basic (position 1) then Full (position 2) at 10000 miles.
-- Historic Van Service is not inferred as Full. Snapshots, responses, service
-- events, and mileage values are not rewritten. Null attachment name snapshots
-- are filled with the old name only while the template is still named Van Service.

BEGIN;
SET LOCAL lock_timeout = '5s';

DO $migration$
DECLARE
  v_van_count INTEGER;
  v_full_count INTEGER;
  v_mode TEXT;
  v_full_id UUID;
  v_basic_id UUID;
  v_basic_count INTEGER;
  v_category_id UUID;
  v_category_count INTEGER;
  v_workshop_category_id UUID;
  v_workshop_scope TEXT;
  v_period_value INTEGER;
  v_period_unit TEXT;
  v_category_name TEXT;
  v_category_description TEXT;
  v_category_applies_to TEXT[];
  v_category_active BOOLEAN;
  v_version_id UUID;
  v_published_count INTEGER;
  v_missing_key TEXT;
  v_duplicate_key TEXT;
  v_applies_to TEXT[];
  v_basic_version_id UUID;
  v_basic_version_count INTEGER;
  v_basic_published_count INTEGER;
  v_basic_section_count INTEGER;
  v_expected_signature TEXT;
  v_actual_signature TEXT;
  v_step_count INTEGER;
  v_full_step_id UUID;
  v_basic_step_id UUID;
  v_link_count INTEGER;
  v_full_link_id UUID;
  v_basic_link_id UUID;
  v_created_basic BOOLEAN := FALSE;
  v_new_version_id UUID;
  v_new_section_id UUID;
  v_section RECORD;
  v_row_count INTEGER;
  v_new_versions INTEGER;
  v_new_templates INTEGER;
  v_fluids_prefix CONSTANT TEXT := 'Engine oil and filter remain a service item. Fuel, air, pollen, and gearbox filters are check or clean only, not replacements.';
  v_optional_prefix CONSTANT TEXT := 'Conditional equipment checks. Complete only where fitted.';
BEGIN
  -- Match completion/settings lock order before acquiring relation locks.
  -- All service categories are covered by the preservation checks below.
  PERFORM id FROM public.maintenance_categories
  WHERE config_key IN ('service_van', 'service_hgv', 'service_plant')
  ORDER BY id FOR UPDATE;

  LOCK TABLE public.workshop_attachment_templates IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_attachment_template_versions IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_attachment_template_sections IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_attachment_template_fields IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_task_attachments IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_attachment_schema_snapshots IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_attachment_field_responses IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.maintenance_categories IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_task_categories IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.workshop_category_attachment_templates IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.service_rotation_steps IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.vehicle_maintenance IN SHARE ROW EXCLUSIVE MODE;
  LOCK TABLE public.asset_service_events IN SHARE ROW EXCLUSIVE MODE;

  DROP TABLE IF EXISTS pg_temp.van_basic_field_map;
  CREATE TEMP TABLE van_basic_field_map (
    source_key TEXT PRIMARY KEY,
    target_key TEXT NOT NULL UNIQUE,
    target_label TEXT NULL,
    section_key TEXT NOT NULL,
    section_title TEXT NOT NULL,
    section_sort INTEGER NOT NULL,
    field_sort INTEGER NOT NULL,
    force_optional BOOLEAN NOT NULL
  );

  INSERT INTO van_basic_field_map (
    source_key, target_key, target_label, section_key, section_title, section_sort, field_sort, force_optional
  )
  VALUES
    ('engine_oil_and_filter', 'engine_oil_and_filter', NULL, 'fluids_and_filters', 'Fluids and filters', 1, 1, FALSE),
    ('change_fuel_filter', 'check_fuel_filter', 'Check fuel filter', 'fluids_and_filters', 'Fluids and filters', 1, 2, FALSE),
    ('change_air_filter', 'check_clean_air_filter', 'Check/clean air filter', 'fluids_and_filters', 'Fluids and filters', 1, 3, FALSE),
    ('change_pollan_filter', 'check_clean_pollen_filter', 'Check/clean pollen filter', 'fluids_and_filters', 'Fluids and filters', 1, 4, FALSE),
    ('gearbox_an_filter_change', 'check_gearbox_oil_and_filter', 'Check gearbox oil and filter', 'fluids_and_filters', 'Fluids and filters', 1, 5, FALSE),
    ('condition_of_all_belts', 'condition_of_all_belts', NULL, 'mechanical_checks', 'Mechanical checks', 2, 1, FALSE),
    ('engine_transmission_mountings', 'engine_transmission_mountings', NULL, 'mechanical_checks', 'Mechanical checks', 2, 2, FALSE),
    ('oil_leaks', 'oil_leaks', NULL, 'mechanical_checks', 'Mechanical checks', 2, 3, FALSE),
    ('fuel_tanks_and_systems', 'fuel_tanks_and_systems', NULL, 'mechanical_checks', 'Mechanical checks', 2, 4, FALSE),
    ('check_brakes_front_and_rear', 'check_brakes_front_and_rear', NULL, 'mechanical_checks', 'Mechanical checks', 2, 5, FALSE),
    ('check_all_suspension_components_for_any_wear', 'check_all_suspension_components_for_any_wear', NULL, 'mechanical_checks', 'Mechanical checks', 2, 6, FALSE),
    ('check_seering_for_any_wear', 'check_seering_for_any_wear', NULL, 'mechanical_checks', 'Mechanical checks', 2, 7, FALSE),
    ('cooling_systems', 'cooling_systems', NULL, 'mechanical_checks', 'Mechanical checks', 2, 8, FALSE),
    ('exhaust_systems', 'exhaust_systems', NULL, 'mechanical_checks', 'Mechanical checks', 2, 9, FALSE),
    ('check_tyres', 'check_tyres', NULL, 'running_gear_and_body', 'Running gear, lights and body', 3, 1, FALSE),
    ('road_wheels_and_hubs', 'road_wheels_and_hubs', NULL, 'running_gear_and_body', 'Running gear, lights and body', 3, 2, FALSE),
    ('check_all_lights_and_horn', 'check_all_lights_and_horn', NULL, 'running_gear_and_body', 'Running gear, lights and body', 3, 3, FALSE),
    ('check_washers_and_wipers', 'check_washers_and_wipers', NULL, 'running_gear_and_body', 'Running gear, lights and body', 3, 4, FALSE),
    ('check_interior_and_exterior_including_mirrors', 'check_interior_and_exterior_including_mirrors', NULL, 'running_gear_and_body', 'Running gear, lights and body', 3, 5, FALSE),
    ('check_for_any_fault_codes', 'check_for_any_fault_codes', NULL, 'running_gear_and_body', 'Running gear, lights and body', 3, 6, FALSE),
    ('check_first_aid_kit_dates', 'check_first_aid_kit_dates', NULL, 'optional_equipment', 'Optional equipment', 4, 1, TRUE),
    ('check_fire_extinguisher', 'check_fire_extinguisher', NULL, 'optional_equipment', 'Optional equipment', 4, 2, TRUE),
    ('vehicle_trailer_coupling', 'vehicle_trailer_coupling', NULL, 'optional_equipment', 'Optional equipment', 4, 3, TRUE);

  SELECT COUNT(*) INTO v_van_count
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = 'van service';

  SELECT COUNT(*) INTO v_full_count
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = 'full service (van)';

  IF v_van_count = 1 AND v_full_count = 0 THEN
    v_mode := 'initial';
    SELECT id INTO v_full_id
    FROM public.workshop_attachment_templates
    WHERE LOWER(name) = 'van service';
  ELSIF v_van_count = 0 AND v_full_count = 1 THEN
    v_mode := 'rerun';
    SELECT id INTO v_full_id
    FROM public.workshop_attachment_templates
    WHERE LOWER(name) = 'full service (van)';
  ELSE
    RAISE EXCEPTION
      'Expected exactly one Van Service or Full Service (Van) template, found van=% full=%',
      v_van_count, v_full_count;
  END IF;

  SELECT applies_to INTO v_applies_to
  FROM public.workshop_attachment_templates
  WHERE id = v_full_id;

  IF v_applies_to IS DISTINCT FROM ARRAY['van']::TEXT[] THEN
    RAISE EXCEPTION 'Van Service template scope is not van';
  END IF;

  SELECT COUNT(*) INTO v_category_count
  FROM public.maintenance_categories
  WHERE config_key = 'service_van';

  IF v_category_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one service_van maintenance category, found %', v_category_count;
  END IF;

  SELECT id, workshop_category_id, period_value, period_unit, name, description, applies_to, is_active
  INTO v_category_id, v_workshop_category_id, v_period_value, v_period_unit,
       v_category_name, v_category_description, v_category_applies_to, v_category_active
  FROM public.maintenance_categories
  WHERE config_key = 'service_van';

  IF v_workshop_category_id IS NULL THEN
    RAISE EXCEPTION 'service_van maintenance category has no workshop category';
  END IF;

  SELECT applies_to::text INTO v_workshop_scope
  FROM public.workshop_task_categories
  WHERE id = v_workshop_category_id;

  IF v_workshop_scope IS DISTINCT FROM 'van' THEN
    RAISE EXCEPTION 'service_van workshop category scope is %, expected van', COALESCE(v_workshop_scope, 'null');
  END IF;

  IF v_mode = 'rerun' THEN
    IF v_period_value IS DISTINCT FROM 10000 OR v_period_unit IS DISTINCT FROM 'miles' THEN
      RAISE EXCEPTION 'service_van interval conflicts with 10000 miles';
    END IF;
  ELSIF (v_period_value IS NOT NULL AND v_period_value <> 10000)
     OR (v_period_unit IS NOT NULL AND v_period_unit <> 'miles') THEN
    RAISE EXCEPTION 'service_van interval conflicts with 10000 miles';
  END IF;

  SELECT COUNT(*) INTO v_published_count
  FROM public.workshop_attachment_template_versions
  WHERE template_id = v_full_id
    AND status = 'published';

  IF v_published_count <> 1 THEN
    RAISE EXCEPTION 'Van Service source does not have exactly one published version';
  END IF;

  SELECT id INTO v_version_id
  FROM public.workshop_attachment_template_versions
  WHERE template_id = v_full_id
    AND status = 'published';

  SELECT m.source_key INTO v_missing_key
  FROM van_basic_field_map m
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.workshop_attachment_template_fields f
    JOIN public.workshop_attachment_template_sections s ON s.id = f.section_id
    WHERE s.version_id = v_version_id
      AND f.field_key = m.source_key
  )
  ORDER BY m.source_key
  LIMIT 1;

  IF v_missing_key IS NOT NULL THEN
    RAISE EXCEPTION 'Van service rotation source is missing required field %', v_missing_key;
  END IF;

  SELECT f.field_key INTO v_duplicate_key
  FROM public.workshop_attachment_template_fields f
  JOIN public.workshop_attachment_template_sections s ON s.id = f.section_id
  WHERE s.version_id = v_version_id
    AND f.field_key IN (SELECT source_key FROM van_basic_field_map)
  GROUP BY f.field_key
  HAVING COUNT(*) > 1
  LIMIT 1;

  IF v_duplicate_key IS NOT NULL THEN
    RAISE EXCEPTION 'Van service rotation source has duplicate field %', v_duplicate_key;
  END IF;

  DROP TABLE IF EXISTS pg_temp.van_basic_section_plan;
  CREATE TEMP TABLE van_basic_section_plan (
    section_key TEXT PRIMARY KEY,
    section_title TEXT NOT NULL,
    section_sort INTEGER NOT NULL,
    description TEXT NOT NULL
  );

  INSERT INTO van_basic_section_plan (section_key, section_title, section_sort, description)
  SELECT
    d.section_key,
    d.section_title,
    d.section_sort,
    CASE
      WHEN COALESCE(n.note_text, '') = '' THEN
        CASE d.section_key
          WHEN 'fluids_and_filters' THEN v_fluids_prefix
          WHEN 'optional_equipment' THEN v_optional_prefix
          ELSE d.section_title
        END
      WHEN d.section_key = 'fluids_and_filters' THEN v_fluids_prefix || ' Source notes: ' || n.note_text
      WHEN d.section_key = 'optional_equipment' THEN v_optional_prefix || ' Source notes: ' || n.note_text
      ELSE n.note_text
    END
  FROM (
    SELECT DISTINCT section_key, section_title, section_sort
    FROM van_basic_field_map
  ) d
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT s.description, ' | ' ORDER BY s.description) AS note_text
    FROM van_basic_field_map m
    JOIN public.workshop_attachment_template_fields f ON f.field_key = m.source_key
    JOIN public.workshop_attachment_template_sections s ON s.id = f.section_id
    WHERE m.section_key = d.section_key
      AND s.version_id = v_version_id
      AND COALESCE(s.description, '') <> ''
  ) n ON TRUE;

  DROP TABLE IF EXISTS pg_temp.van_basic_field_plan;
  CREATE TEMP TABLE van_basic_field_plan (
    source_key TEXT PRIMARY KEY,
    target_key TEXT NOT NULL,
    label TEXT NOT NULL,
    help_text TEXT NULL,
    field_type public.workshop_attachment_field_type NOT NULL,
    is_required BOOLEAN NOT NULL,
    field_sort INTEGER NOT NULL,
    options_json JSONB NULL,
    validation_json JSONB NULL,
    section_key TEXT NOT NULL
  );

  INSERT INTO van_basic_field_plan (
    source_key, target_key, label, help_text, field_type, is_required, field_sort,
    options_json, validation_json, section_key
  )
  SELECT
    m.source_key,
    m.target_key,
    COALESCE(m.target_label, f.label),
    f.help_text,
    f.field_type,
    CASE WHEN m.force_optional THEN FALSE ELSE f.is_required END,
    m.field_sort,
    f.options_json,
    f.validation_json,
    m.section_key
  FROM van_basic_field_map m
  JOIN public.workshop_attachment_template_sections s
    ON s.version_id = v_version_id
  JOIN public.workshop_attachment_template_fields f
    ON f.section_id = s.id
   AND f.field_key = m.source_key;

  IF (SELECT COUNT(*) FROM van_basic_field_plan) <> 23 THEN
    RAISE EXCEPTION 'Van service rotation field plan did not resolve 23 fields';
  END IF;

  SELECT COALESCE(string_agg(
    concat_ws(
      chr(31),
      COALESCE(s.section_sort::text, ''),
      COALESCE(s.section_key, ''),
      COALESCE(s.section_title, ''),
      COALESCE(s.description, ''),
      COALESCE(p.field_sort::text, ''),
      COALESCE(p.target_key, ''),
      COALESCE(p.label, ''),
      COALESCE(p.help_text, ''),
      COALESCE(p.field_type::text, ''),
      COALESCE(p.is_required::text, ''),
      COALESCE(p.options_json::text, 'null'),
      COALESCE(p.validation_json::text, 'null')
    ),
    chr(30)
    ORDER BY s.section_sort, p.field_sort, p.target_key
  ), '')
  INTO v_expected_signature
  FROM van_basic_field_plan p
  JOIN van_basic_section_plan s ON s.section_key = p.section_key;

  SELECT COUNT(*) INTO v_basic_count
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = 'basic service a (van)';

  IF v_basic_count > 1 THEN
    RAISE EXCEPTION 'Ambiguous target template name "Basic Service A (Van)": found % rows', v_basic_count;
  END IF;

  SELECT id INTO v_basic_id
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = 'basic service a (van)';

  IF v_basic_id IS NOT NULL THEN
    SELECT COUNT(*) INTO v_basic_version_count
    FROM public.workshop_attachment_template_versions
    WHERE template_id = v_basic_id;

    SELECT COUNT(*) INTO v_basic_published_count
    FROM public.workshop_attachment_template_versions
    WHERE template_id = v_basic_id
      AND status = 'published';

    SELECT id INTO v_basic_version_id
    FROM public.workshop_attachment_template_versions
    WHERE template_id = v_basic_id
      AND status = 'published'
    ORDER BY version_number DESC
    LIMIT 1;

    IF v_basic_published_count <> 1 OR v_basic_version_count <> 1 OR v_basic_version_id IS NULL THEN
      RAISE EXCEPTION 'Target "Basic Service A (Van)" already exists with a conflicting published schema';
    END IF;

    SELECT COUNT(*) INTO v_basic_section_count
    FROM public.workshop_attachment_template_sections
    WHERE version_id = v_basic_version_id;

    SELECT COALESCE(string_agg(
      concat_ws(
        chr(31),
        COALESCE(s.sort_order::text, ''),
        COALESCE(s.section_key, ''),
        COALESCE(s.title, ''),
        COALESCE(s.description, ''),
        COALESCE(f.sort_order::text, ''),
        COALESCE(f.field_key, ''),
        COALESCE(f.label, ''),
        COALESCE(f.help_text, ''),
        COALESCE(f.field_type::text, ''),
        COALESCE(f.is_required::text, ''),
        COALESCE(f.options_json::text, 'null'),
        COALESCE(f.validation_json::text, 'null')
      ),
      chr(30)
      ORDER BY s.sort_order, f.sort_order, f.field_key
    ), '')
    INTO v_actual_signature
    FROM public.workshop_attachment_template_sections s
    JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
    WHERE s.version_id = v_basic_version_id;

    IF v_actual_signature IS DISTINCT FROM v_expected_signature
       OR v_basic_section_count IS DISTINCT FROM (SELECT COUNT(*) FROM van_basic_section_plan) THEN
      RAISE EXCEPTION 'Target "Basic Service A (Van)" already exists with a conflicting published schema';
    END IF;
  ELSIF v_mode = 'rerun' THEN
    RAISE EXCEPTION 'Target "Basic Service A (Van)" already exists with a conflicting published schema';
  END IF;

  SELECT COUNT(*) INTO v_step_count
  FROM public.service_rotation_steps
  WHERE maintenance_category_id = v_category_id;

  IF v_mode = 'initial' THEN
    SELECT id INTO v_full_step_id
    FROM public.service_rotation_steps
    WHERE maintenance_category_id = v_category_id
      AND position = 1
      AND attachment_template_id = v_full_id;

    IF v_step_count <> 1 OR v_full_step_id IS NULL THEN
      RAISE EXCEPTION 'service_van rotation conflicts with the expected initial or completed shape';
    END IF;
  ELSE
    SELECT id INTO v_full_step_id
    FROM public.service_rotation_steps
    WHERE maintenance_category_id = v_category_id
      AND position = 2
      AND attachment_template_id = v_full_id;

    SELECT id INTO v_basic_step_id
    FROM public.service_rotation_steps
    WHERE maintenance_category_id = v_category_id
      AND position = 1
      AND attachment_template_id = v_basic_id;

    IF v_step_count <> 2 OR v_full_step_id IS NULL OR v_basic_step_id IS NULL THEN
      RAISE EXCEPTION 'service_van rotation conflicts with the expected initial or completed shape';
    END IF;
  END IF;

  SELECT COUNT(*) INTO v_link_count
  FROM public.workshop_category_attachment_templates
  WHERE category_id = v_workshop_category_id;

  SELECT id INTO v_full_link_id
  FROM public.workshop_category_attachment_templates
  WHERE category_id = v_workshop_category_id
    AND template_id = v_full_id;

  IF v_basic_id IS NOT NULL THEN
    SELECT id INTO v_basic_link_id
    FROM public.workshop_category_attachment_templates
    WHERE category_id = v_workshop_category_id
      AND template_id = v_basic_id;
  END IF;

  IF v_mode = 'rerun' THEN
    IF v_link_count <> 2 OR v_full_link_id IS NULL OR v_basic_link_id IS NULL THEN
      RAISE EXCEPTION 'service_van category attachment links conflict with the expected initial or completed shape';
    END IF;
    RETURN;
  END IF;

  IF v_link_count <> 1 OR v_full_link_id IS NULL OR v_basic_link_id IS NOT NULL THEN
    RAISE EXCEPTION 'service_van category attachment links conflict with the expected initial or completed shape';
  END IF;

  DROP TABLE IF EXISTS pg_temp.van_templates_before;
  CREATE TEMP TABLE van_templates_before AS
  SELECT id, name, description, is_active, applies_to
  FROM public.workshop_attachment_templates;

  DROP TABLE IF EXISTS pg_temp.van_versions_before;
  CREATE TEMP TABLE van_versions_before AS
  SELECT id, template_id, version_number, status::text AS status
  FROM public.workshop_attachment_template_versions;

  DROP TABLE IF EXISTS pg_temp.van_sections_before;
  CREATE TEMP TABLE van_sections_before AS
  SELECT id, version_id, section_key, title, description, sort_order
  FROM public.workshop_attachment_template_sections;

  DROP TABLE IF EXISTS pg_temp.van_fields_before;
  CREATE TEMP TABLE van_fields_before AS
  SELECT
    f.id,
    f.section_id,
    f.field_key,
    f.label,
    f.help_text,
    f.field_type::text AS field_type,
    f.is_required,
    f.sort_order,
    f.options_json,
    f.validation_json
  FROM public.workshop_attachment_template_fields f;

  DROP TABLE IF EXISTS pg_temp.van_attach_before;
  CREATE TEMP TABLE van_attach_before AS
  SELECT id, template_id, status::text AS status, template_name_snapshot
  FROM public.workshop_task_attachments;

  DROP TABLE IF EXISTS pg_temp.van_snap_before;
  CREATE TEMP TABLE van_snap_before AS
  SELECT id, attachment_id, template_version_id, snapshot_json
  FROM public.workshop_attachment_schema_snapshots;

  DROP TABLE IF EXISTS pg_temp.van_resp_before;
  CREATE TEMP TABLE van_resp_before AS
  SELECT id, attachment_id, section_key, field_key, response_value, response_json
  FROM public.workshop_attachment_field_responses;

  DROP TABLE IF EXISTS pg_temp.van_events_before;
  CREATE TEMP TABLE van_events_before AS
  SELECT
    id,
    completed_template_id,
    completed_template_name,
    next_template_id,
    next_template_name,
    notes,
    completion_meter,
    resulting_due_meter
  FROM public.asset_service_events;

  DROP TABLE IF EXISTS pg_temp.van_vm_before;
  CREATE TEMP TABLE van_vm_before AS
  SELECT
    id,
    van_id,
    hgv_id,
    plant_id,
    current_mileage,
    last_service_mileage,
    next_service_mileage,
    current_hours,
    last_service_hours,
    next_service_hours,
    last_service_template_id,
    next_service_template_id,
    next_service_rotation_step_id,
    notes
  FROM public.vehicle_maintenance;

  DROP TABLE IF EXISTS pg_temp.van_steps_before;
  CREATE TEMP TABLE van_steps_before AS
  SELECT id, maintenance_category_id, position, attachment_template_id
  FROM public.service_rotation_steps;

  DROP TABLE IF EXISTS pg_temp.van_links_before;
  CREATE TEMP TABLE van_links_before AS
  SELECT id, category_id, template_id, sort_order, compact_label
  FROM public.workshop_category_attachment_templates;

  DROP TABLE IF EXISTS pg_temp.van_categories_before;
  CREATE TEMP TABLE van_categories_before AS
  SELECT id, config_key, name, description, period_value, period_unit, workshop_category_id, applies_to, is_active
  FROM public.maintenance_categories;

  UPDATE public.workshop_task_attachments
  SET template_name_snapshot = 'Van Service'
  WHERE template_id = v_full_id
    AND template_name_snapshot IS NULL;

  UPDATE public.workshop_attachment_templates
  SET name = 'Full Service (Van)',
      updated_at = NOW()
  WHERE id = v_full_id
    AND name IS NOT DISTINCT FROM (
      SELECT name FROM van_templates_before WHERE id = v_full_id
    );

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Failed to preserve the Van Service template as Full Service (Van)';
  END IF;

  IF v_basic_id IS NULL THEN
    INSERT INTO public.workshop_attachment_templates (name, description, is_active, applies_to)
    VALUES (
      'Basic Service A (Van)',
      'Compact van basic service checklist. Engine oil and filter are serviced. Fuel, air, pollen, and gearbox filters are check or clean only.',
      TRUE,
      ARRAY['van']::TEXT[]
    )
    RETURNING id INTO v_basic_id;

    INSERT INTO public.workshop_attachment_template_versions (template_id, version_number, status)
    VALUES (v_basic_id, 1, 'published')
    RETURNING id INTO v_new_version_id;

    v_created_basic := TRUE;

    FOR v_section IN
      SELECT section_key, section_title, section_sort, description
      FROM van_basic_section_plan
      ORDER BY section_sort, section_key
    LOOP
      INSERT INTO public.workshop_attachment_template_sections (
        version_id, section_key, title, description, sort_order
      )
      VALUES (
        v_new_version_id,
        v_section.section_key,
        v_section.section_title,
        v_section.description,
        v_section.section_sort
      )
      RETURNING id INTO v_new_section_id;

      INSERT INTO public.workshop_attachment_template_fields (
        section_id, field_key, label, help_text, field_type, is_required, sort_order, options_json, validation_json
      )
      SELECT
        v_new_section_id,
        p.target_key,
        p.label,
        p.help_text,
        p.field_type,
        p.is_required,
        p.field_sort,
        p.options_json,
        p.validation_json
      FROM van_basic_field_plan p
      WHERE p.section_key = v_section.section_key
      ORDER BY p.field_sort, p.target_key;
    END LOOP;

    SELECT COALESCE(string_agg(
      concat_ws(
        chr(31),
        COALESCE(s.sort_order::text, ''),
        COALESCE(s.section_key, ''),
        COALESCE(s.title, ''),
        COALESCE(s.description, ''),
        COALESCE(f.sort_order::text, ''),
        COALESCE(f.field_key, ''),
        COALESCE(f.label, ''),
        COALESCE(f.help_text, ''),
        COALESCE(f.field_type::text, ''),
        COALESCE(f.is_required::text, ''),
        COALESCE(f.options_json::text, 'null'),
        COALESCE(f.validation_json::text, 'null')
      ),
      chr(30)
      ORDER BY s.sort_order, f.sort_order, f.field_key
    ), '')
    INTO v_actual_signature
    FROM public.workshop_attachment_template_sections s
    JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
    WHERE s.version_id = v_new_version_id;

    IF v_actual_signature IS DISTINCT FROM v_expected_signature THEN
      RAISE EXCEPTION 'Failed to publish exact schema for "Basic Service A (Van)"';
    END IF;
  END IF;

  UPDATE public.service_rotation_steps
  SET position = 2,
      updated_at = NOW()
  WHERE id = v_full_step_id
    AND maintenance_category_id = v_category_id
    AND position = 1
    AND attachment_template_id = v_full_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Failed to preserve the existing Full Service (Van) rotation row';
  END IF;

  INSERT INTO public.service_rotation_steps (maintenance_category_id, position, attachment_template_id)
  VALUES (v_category_id, 1, v_basic_id);

  UPDATE public.vehicle_maintenance
  SET next_service_template_id = NULL,
      next_service_rotation_step_id = NULL
  WHERE van_id IS NOT NULL
    AND hgv_id IS NULL
    AND plant_id IS NULL
    AND (
      next_service_template_id = v_full_id
      OR next_service_rotation_step_id = v_full_step_id
    );

  UPDATE public.workshop_category_attachment_templates
  SET sort_order = 2,
      compact_label = 'Full',
      updated_at = NOW()
  WHERE id = v_full_link_id
    AND category_id = v_workshop_category_id
    AND template_id = v_full_id;

  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'Failed to preserve the Full Service (Van) category link';
  END IF;

  INSERT INTO public.workshop_category_attachment_templates (
    category_id, template_id, sort_order, compact_label
  )
  VALUES (v_workshop_category_id, v_basic_id, 1, 'Basic A');

  UPDATE public.maintenance_categories
  SET period_value = 10000,
      period_unit = 'miles'
  WHERE id = v_category_id
    AND config_key = 'service_van'
    AND period_value IS NULL
    AND (period_unit IS NULL OR period_unit = 'miles');

  IF EXISTS (
    SELECT 1
    FROM van_fields_before b
    JOIN public.workshop_attachment_template_fields f ON f.id = b.id
    WHERE f.section_id IS DISTINCT FROM b.section_id
       OR f.field_key IS DISTINCT FROM b.field_key
       OR f.label IS DISTINCT FROM b.label
       OR f.help_text IS DISTINCT FROM b.help_text
       OR f.field_type::text IS DISTINCT FROM b.field_type
       OR f.is_required IS DISTINCT FROM b.is_required
       OR f.sort_order IS DISTINCT FROM b.sort_order
       OR f.options_json IS DISTINCT FROM b.options_json
       OR f.validation_json IS DISTINCT FROM b.validation_json
  ) OR EXISTS (
    SELECT 1 FROM van_fields_before b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workshop_attachment_template_fields f WHERE f.id = b.id
    )
  ) THEN
    RAISE EXCEPTION 'Existing template fields changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_sections_before b
    JOIN public.workshop_attachment_template_sections s ON s.id = b.id
    WHERE s.version_id IS DISTINCT FROM b.version_id
       OR s.section_key IS DISTINCT FROM b.section_key
       OR s.title IS DISTINCT FROM b.title
       OR s.description IS DISTINCT FROM b.description
       OR s.sort_order IS DISTINCT FROM b.sort_order
  ) OR EXISTS (
    SELECT 1 FROM van_sections_before b
    WHERE NOT EXISTS (
      SELECT 1 FROM public.workshop_attachment_template_sections s WHERE s.id = b.id
    )
  ) THEN
    RAISE EXCEPTION 'Existing template sections changed';
  END IF;

  IF EXISTS (
    SELECT id, template_id, version_number, status FROM van_versions_before
    EXCEPT
    SELECT id, template_id, version_number, status::text
    FROM public.workshop_attachment_template_versions
  ) THEN
    RAISE EXCEPTION 'Existing template versions changed';
  END IF;

  SELECT COUNT(*) INTO v_new_versions
  FROM public.workshop_attachment_template_versions v
  WHERE NOT EXISTS (SELECT 1 FROM van_versions_before b WHERE b.id = v.id);

  IF v_created_basic AND v_new_versions <> 1 THEN
    RAISE EXCEPTION 'Basic Service A (Van) published version was not created exactly once';
  ELSIF NOT v_created_basic AND v_new_versions <> 0 THEN
    RAISE EXCEPTION 'Existing template versions changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_templates_before b
    JOIN public.workshop_attachment_templates t ON t.id = b.id
    WHERE b.id IS DISTINCT FROM v_full_id
      AND (
        t.name IS DISTINCT FROM b.name
        OR t.description IS DISTINCT FROM b.description
        OR t.is_active IS DISTINCT FROM b.is_active
        OR t.applies_to IS DISTINCT FROM b.applies_to
      )
  ) OR EXISTS (
    SELECT 1 FROM van_templates_before b
    WHERE NOT EXISTS (SELECT 1 FROM public.workshop_attachment_templates t WHERE t.id = b.id)
  ) THEN
    RAISE EXCEPTION 'Existing templates other than the renamed Van Service changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.workshop_attachment_templates t
    JOIN van_templates_before b ON b.id = t.id
    WHERE t.id = v_full_id
      AND t.name = 'Full Service (Van)'
      AND t.description IS NOT DISTINCT FROM b.description
      AND t.is_active IS NOT DISTINCT FROM b.is_active
      AND t.applies_to IS NOT DISTINCT FROM b.applies_to
  ) THEN
    RAISE EXCEPTION 'Full Service (Van) identity or published template metadata changed';
  END IF;

  SELECT COUNT(*) INTO v_new_templates
  FROM public.workshop_attachment_templates t
  WHERE NOT EXISTS (SELECT 1 FROM van_templates_before b WHERE b.id = t.id);

  IF v_created_basic AND v_new_templates <> 1 THEN
    RAISE EXCEPTION 'Basic Service A (Van) template was not created exactly once';
  ELSIF NOT v_created_basic AND v_new_templates <> 0 THEN
    RAISE EXCEPTION 'Unexpected template was created';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_snap_before b
    FULL OUTER JOIN public.workshop_attachment_schema_snapshots s ON s.id = b.id
    WHERE s.id IS NULL
       OR b.id IS NULL
       OR s.attachment_id IS DISTINCT FROM b.attachment_id
       OR s.template_version_id IS DISTINCT FROM b.template_version_id
       OR s.snapshot_json IS DISTINCT FROM b.snapshot_json
  ) THEN
    RAISE EXCEPTION 'Attachment schema snapshots changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_resp_before b
    FULL OUTER JOIN public.workshop_attachment_field_responses r ON r.id = b.id
    WHERE r.id IS NULL
       OR b.id IS NULL
       OR r.attachment_id IS DISTINCT FROM b.attachment_id
       OR r.section_key IS DISTINCT FROM b.section_key
       OR r.field_key IS DISTINCT FROM b.field_key
       OR r.response_value IS DISTINCT FROM b.response_value
       OR r.response_json IS DISTINCT FROM b.response_json
  ) THEN
    RAISE EXCEPTION 'Attachment responses changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_events_before b
    FULL OUTER JOIN public.asset_service_events e ON e.id = b.id
    WHERE e.id IS NULL
       OR b.id IS NULL
       OR e.completed_template_id IS DISTINCT FROM b.completed_template_id
       OR e.completed_template_name IS DISTINCT FROM b.completed_template_name
       OR e.next_template_id IS DISTINCT FROM b.next_template_id
       OR e.next_template_name IS DISTINCT FROM b.next_template_name
       OR e.notes IS DISTINCT FROM b.notes
       OR e.completion_meter IS DISTINCT FROM b.completion_meter
       OR e.resulting_due_meter IS DISTINCT FROM b.resulting_due_meter
  ) THEN
    RAISE EXCEPTION 'Service events changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_attach_before b
    JOIN public.workshop_task_attachments a ON a.id = b.id
    WHERE a.template_id IS DISTINCT FROM b.template_id
       OR a.status::text IS DISTINCT FROM b.status
       OR (
         b.template_name_snapshot IS NOT NULL
         AND a.template_name_snapshot IS DISTINCT FROM b.template_name_snapshot
       )
       OR (
         b.template_name_snapshot IS NULL
         AND b.template_id IS DISTINCT FROM v_full_id
         AND a.template_name_snapshot IS NOT NULL
       )
       OR (
         b.template_name_snapshot IS NULL
         AND b.template_id = v_full_id
         AND a.template_name_snapshot IS DISTINCT FROM 'Van Service'
       )
  ) THEN
    RAISE EXCEPTION 'Attachment name snapshots were not preserved';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_vm_before b
    JOIN public.vehicle_maintenance vm ON vm.id = b.id
    WHERE vm.current_mileage IS DISTINCT FROM b.current_mileage
       OR vm.last_service_mileage IS DISTINCT FROM b.last_service_mileage
       OR vm.next_service_mileage IS DISTINCT FROM b.next_service_mileage
       OR vm.current_hours IS DISTINCT FROM b.current_hours
       OR vm.last_service_hours IS DISTINCT FROM b.last_service_hours
       OR vm.next_service_hours IS DISTINCT FROM b.next_service_hours
       OR vm.last_service_template_id IS DISTINCT FROM b.last_service_template_id
       OR vm.notes IS DISTINCT FROM b.notes
       OR vm.van_id IS DISTINCT FROM b.van_id
       OR vm.hgv_id IS DISTINCT FROM b.hgv_id
       OR vm.plant_id IS DISTINCT FROM b.plant_id
       OR (
         NOT (b.van_id IS NOT NULL AND b.hgv_id IS NULL AND b.plant_id IS NULL)
         AND (
           vm.next_service_template_id IS DISTINCT FROM b.next_service_template_id
           OR vm.next_service_rotation_step_id IS DISTINCT FROM b.next_service_rotation_step_id
         )
       )
       OR (
         b.van_id IS NOT NULL AND b.hgv_id IS NULL AND b.plant_id IS NULL
         AND b.next_service_template_id IS DISTINCT FROM v_full_id
         AND b.next_service_rotation_step_id IS DISTINCT FROM v_full_step_id
         AND (
           vm.next_service_template_id IS DISTINCT FROM b.next_service_template_id
           OR vm.next_service_rotation_step_id IS DISTINCT FROM b.next_service_rotation_step_id
         )
       )
       OR (
         b.van_id IS NOT NULL AND b.hgv_id IS NULL AND b.plant_id IS NULL
         AND (
           b.next_service_template_id = v_full_id
           OR b.next_service_rotation_step_id = v_full_step_id
         )
         AND (
           vm.next_service_template_id IS NOT NULL
           OR vm.next_service_rotation_step_id IS NOT NULL
         )
       )
  ) THEN
    RAISE EXCEPTION 'Vehicle maintenance mileage or non-van cursors changed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.service_rotation_steps
    WHERE id = v_full_step_id
      AND maintenance_category_id = v_category_id
      AND position = 2
      AND attachment_template_id = v_full_id
  ) THEN
    RAISE EXCEPTION 'Existing Full Service (Van) rotation row was not moved to position 2';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_steps_before b
    JOIN public.service_rotation_steps s ON s.id = b.id
    WHERE b.id IS DISTINCT FROM v_full_step_id
      AND (
        s.position IS DISTINCT FROM b.position
        OR s.attachment_template_id IS DISTINCT FROM b.attachment_template_id
        OR s.maintenance_category_id IS DISTINCT FROM b.maintenance_category_id
      )
  ) OR EXISTS (
    SELECT 1 FROM van_steps_before b
    WHERE NOT EXISTS (SELECT 1 FROM public.service_rotation_steps s WHERE s.id = b.id)
  ) THEN
    RAISE EXCEPTION 'Rotation rows outside the van full-service step changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_categories_before b
    JOIN public.maintenance_categories c ON c.id = b.id
    WHERE b.id IS DISTINCT FROM v_category_id
      AND (
        c.config_key IS DISTINCT FROM b.config_key
        OR c.name IS DISTINCT FROM b.name
        OR c.description IS DISTINCT FROM b.description
        OR c.period_value IS DISTINCT FROM b.period_value
        OR c.period_unit IS DISTINCT FROM b.period_unit
        OR c.workshop_category_id IS DISTINCT FROM b.workshop_category_id
        OR c.applies_to IS DISTINCT FROM b.applies_to
        OR c.is_active IS DISTINCT FROM b.is_active
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.maintenance_categories c
    WHERE c.id = v_category_id
      AND c.config_key = 'service_van'
      AND c.name IS NOT DISTINCT FROM v_category_name
      AND c.description IS NOT DISTINCT FROM v_category_description
      AND c.period_value = 10000
      AND c.period_unit = 'miles'
      AND c.workshop_category_id = v_workshop_category_id
      AND c.applies_to IS NOT DISTINCT FROM v_category_applies_to
      AND c.is_active IS NOT DISTINCT FROM v_category_active
  ) THEN
    RAISE EXCEPTION 'Maintenance categories outside service_van interval fill changed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM van_links_before b
    JOIN public.workshop_category_attachment_templates l ON l.id = b.id
    WHERE b.id IS DISTINCT FROM v_full_link_id
      AND (
        l.category_id IS DISTINCT FROM b.category_id
        OR l.template_id IS DISTINCT FROM b.template_id
        OR l.sort_order IS DISTINCT FROM b.sort_order
        OR l.compact_label IS DISTINCT FROM b.compact_label
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM public.workshop_category_attachment_templates
    WHERE id = v_full_link_id
      AND template_id = v_full_id
      AND category_id = v_workshop_category_id
      AND sort_order = 2
      AND compact_label = 'Full'
  ) THEN
    RAISE EXCEPTION 'Category attachment links outside the van full-service link changed';
  END IF;
END;
$migration$;

COMMIT;
