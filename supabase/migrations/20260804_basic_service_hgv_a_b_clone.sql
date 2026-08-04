-- Migration: Clone Basic Service (HGV) into A/B variants and retire the original
-- Date: 2026-08-04
-- Purpose:
--   1. Publish "Basic Service A (HGV)" (source minus renew_air_dryer_filter)
--   2. Publish "Basic Service B (HGV)" (clean_out_air_filter -> renew_air_filter / Renew air filter)
--   3. Deactivate "Basic Service (HGV)" for new selection (existing snapshots unchanged)
-- Idempotent: exact existing targets are accepted; conflicting schemas always abort.

BEGIN;

CREATE OR REPLACE FUNCTION public._basic_service_hgv_schema_signature(
  p_version_id UUID,
  p_mode TEXT DEFAULT NULL
)
RETURNS TEXT
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    string_agg(
      part,
      chr(30)
      ORDER BY section_sort_order, field_sort_order, field_key_sort
    ),
    ''
  )
  FROM (
    SELECT
      s.sort_order AS section_sort_order,
      COALESCE(f.sort_order, -1) AS field_sort_order,
      COALESCE(
        CASE
          WHEN p_mode = 'renew_air_filter' AND f.field_key = 'clean_out_air_filter' THEN 'renew_air_filter'
          ELSE f.field_key
        END,
        ''
      ) AS field_key_sort,
      concat_ws(
        chr(31),
        'S',
        s.section_key,
        s.title,
        COALESCE(s.description, ''),
        s.sort_order::text,
        CASE WHEN f.id IS NULL THEN 'NO_FIELDS' ELSE 'F' END,
        CASE
          WHEN f.id IS NULL THEN ''
          WHEN p_mode = 'renew_air_filter' AND f.field_key = 'clean_out_air_filter' THEN 'renew_air_filter'
          ELSE f.field_key
        END,
        CASE
          WHEN f.id IS NULL THEN ''
          WHEN p_mode = 'renew_air_filter' AND f.field_key = 'clean_out_air_filter' THEN 'Renew air filter'
          ELSE f.label
        END,
        COALESCE(f.help_text, ''),
        COALESCE(f.field_type::text, ''),
        COALESCE(f.is_required::text, ''),
        COALESCE(f.sort_order::text, ''),
        COALESCE(f.options_json::text, 'null'),
        COALESCE(f.validation_json::text, 'null')
      ) AS part
    FROM public.workshop_attachment_template_sections s
    LEFT JOIN public.workshop_attachment_template_fields f
      ON f.section_id = s.id
     AND NOT (
       p_mode IS NOT DISTINCT FROM 'omit_air_dryer'
       AND f.field_key = 'renew_air_dryer_filter'
     )
    WHERE s.version_id = p_version_id
  ) signature_parts;
$$;

CREATE OR REPLACE FUNCTION public._clone_basic_service_hgv_variant(
  p_source_template_id UUID,
  p_source_version_id UUID,
  p_description TEXT,
  p_applies_to TEXT[],
  p_target_name TEXT,
  p_mode TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_target_id UUID;
  v_target_count INTEGER;
  v_existing_version_id UUID;
  v_existing_published_count INTEGER;
  v_existing_version_count INTEGER;
  v_next_version INTEGER;
  v_new_version_id UUID;
  v_source_section RECORD;
  v_source_field RECORD;
  v_new_section_id UUID;
  v_field_key TEXT;
  v_field_label TEXT;
  v_expected_signature TEXT;
  v_actual_signature TEXT;
BEGIN
  PERFORM p_source_template_id;

  IF p_mode NOT IN ('omit_air_dryer', 'renew_air_filter') THEN
    RAISE EXCEPTION 'Unsupported clone mode: %', p_mode;
  END IF;

  SELECT COUNT(*)
  INTO v_target_count
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = LOWER(p_target_name);

  IF v_target_count > 1 THEN
    RAISE EXCEPTION 'Ambiguous target template name "%": found % rows', p_target_name, v_target_count;
  END IF;

  SELECT id
  INTO v_target_id
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = LOWER(p_target_name)
  LIMIT 1;

  IF v_target_id IS NULL THEN
    INSERT INTO public.workshop_attachment_templates (
      name,
      description,
      is_active,
      applies_to
    )
    VALUES (
      p_target_name,
      p_description,
      true,
      p_applies_to
    )
    RETURNING id INTO v_target_id;
  ELSE
    UPDATE public.workshop_attachment_templates
    SET description = p_description,
        applies_to = p_applies_to,
        is_active = true,
        updated_at = NOW()
    WHERE id = v_target_id;
  END IF;

  v_expected_signature := public._basic_service_hgv_schema_signature(p_source_version_id, p_mode);

  SELECT COUNT(*)
  INTO v_existing_published_count
  FROM public.workshop_attachment_template_versions
  WHERE template_id = v_target_id
    AND status = 'published';

  SELECT v.id
  INTO v_existing_version_id
  FROM public.workshop_attachment_template_versions v
  WHERE v.template_id = v_target_id
    AND v.status = 'published'
  ORDER BY v.version_number DESC
  LIMIT 1;

  SELECT COUNT(*)
  INTO v_existing_version_count
  FROM public.workshop_attachment_template_versions
  WHERE template_id = v_target_id;

  IF v_existing_version_id IS NOT NULL THEN
    v_actual_signature := public._basic_service_hgv_schema_signature(v_existing_version_id, NULL);

    IF v_actual_signature IS NOT DISTINCT FROM v_expected_signature
       AND v_existing_published_count = 1 THEN
      -- Exact published schema is acceptable only when no extra unpublished versions exist.
      -- Attachments on an exact target are allowed so reruns remain idempotent after use.
      IF v_existing_version_count <> 1 THEN
        RAISE EXCEPTION
          'Target "%" has unpublished or extra versions alongside the published schema',
          p_target_name;
      END IF;
      RETURN;
    END IF;

    RAISE EXCEPTION
      'Target "%" already exists with a conflicting published schema',
      p_target_name;
  END IF;

  -- Draft-only / unpublished target rows (no usable published match) are a conflict.
  IF v_existing_version_count > 0
     OR EXISTS (
       SELECT 1
       FROM public.workshop_task_attachments
       WHERE template_id = v_target_id
     ) THEN
    RAISE EXCEPTION
      'Target "%" already exists with conflicting unpublished versions or attachments',
      p_target_name;
  END IF;

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM public.workshop_attachment_template_versions
  WHERE template_id = v_target_id;

  INSERT INTO public.workshop_attachment_template_versions (
    template_id,
    version_number,
    status
  )
  VALUES (
    v_target_id,
    v_next_version,
    'published'
  )
  RETURNING id INTO v_new_version_id;

  FOR v_source_section IN
    SELECT *
    FROM public.workshop_attachment_template_sections
    WHERE version_id = p_source_version_id
    ORDER BY sort_order, section_key
  LOOP
    INSERT INTO public.workshop_attachment_template_sections (
      version_id,
      section_key,
      title,
      description,
      sort_order
    )
    VALUES (
      v_new_version_id,
      v_source_section.section_key,
      v_source_section.title,
      v_source_section.description,
      v_source_section.sort_order
    )
    RETURNING id INTO v_new_section_id;

    FOR v_source_field IN
      SELECT *
      FROM public.workshop_attachment_template_fields
      WHERE section_id = v_source_section.id
      ORDER BY sort_order, field_key
    LOOP
      IF p_mode = 'omit_air_dryer' AND v_source_field.field_key = 'renew_air_dryer_filter' THEN
        CONTINUE;
      END IF;

      v_field_key := v_source_field.field_key;
      v_field_label := v_source_field.label;

      IF p_mode = 'renew_air_filter' AND v_source_field.field_key = 'clean_out_air_filter' THEN
        v_field_key := 'renew_air_filter';
        v_field_label := 'Renew air filter';
      END IF;

      INSERT INTO public.workshop_attachment_template_fields (
        section_id,
        field_key,
        label,
        help_text,
        field_type,
        is_required,
        sort_order,
        options_json,
        validation_json
      )
      VALUES (
        v_new_section_id,
        v_field_key,
        v_field_label,
        v_source_field.help_text,
        v_source_field.field_type,
        v_source_field.is_required,
        v_source_field.sort_order,
        v_source_field.options_json,
        v_source_field.validation_json
      );
    END LOOP;
  END LOOP;

  v_actual_signature := public._basic_service_hgv_schema_signature(v_new_version_id, NULL);

  IF v_actual_signature IS DISTINCT FROM v_expected_signature THEN
    RAISE EXCEPTION
      'Failed to publish exact schema for "%". expected=% actual=%',
      p_target_name,
      v_expected_signature,
      v_actual_signature;
  END IF;
END;
$$;

DO $$
DECLARE
  v_source_name CONSTANT TEXT := 'Basic Service (HGV)';
  v_target_a_name CONSTANT TEXT := 'Basic Service A (HGV)';
  v_target_b_name CONSTANT TEXT := 'Basic Service B (HGV)';
  v_source_count INTEGER;
  v_source_id UUID;
  v_source_version_id UUID;
  v_source_description TEXT;
  v_source_applies_to TEXT[];
  v_has_clean_out BOOLEAN;
  v_has_air_dryer BOOLEAN;
BEGIN
  LOCK TABLE public.workshop_attachment_templates IN SHARE ROW EXCLUSIVE MODE;

  SELECT COUNT(*)
  INTO v_source_count
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = LOWER(v_source_name);

  IF v_source_count <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one "%" template, found %',
      v_source_name,
      v_source_count;
  END IF;

  SELECT id, description, applies_to
  INTO v_source_id, v_source_description, v_source_applies_to
  FROM public.workshop_attachment_templates
  WHERE LOWER(name) = LOWER(v_source_name)
  LIMIT 1;

  SELECT v.id
  INTO v_source_version_id
  FROM public.workshop_attachment_template_versions v
  WHERE v.template_id = v_source_id
    AND v.status = 'published'
  ORDER BY v.version_number DESC
  LIMIT 1;

  IF v_source_version_id IS NULL THEN
    RAISE EXCEPTION 'Source template "%" has no published version', v_source_name;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.workshop_attachment_template_sections s
    INNER JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
    WHERE s.version_id = v_source_version_id
      AND f.field_key = 'clean_out_air_filter'
  )
  INTO v_has_clean_out;

  SELECT EXISTS (
    SELECT 1
    FROM public.workshop_attachment_template_sections s
    INNER JOIN public.workshop_attachment_template_fields f ON f.section_id = s.id
    WHERE s.version_id = v_source_version_id
      AND f.field_key = 'renew_air_dryer_filter'
  )
  INTO v_has_air_dryer;

  IF NOT v_has_clean_out OR NOT v_has_air_dryer THEN
    RAISE EXCEPTION
      'Source template "%" latest published version is missing required fields (clean_out_air_filter=%, renew_air_dryer_filter=%)',
      v_source_name,
      v_has_clean_out,
      v_has_air_dryer;
  END IF;

  PERFORM public._clone_basic_service_hgv_variant(
    v_source_id,
    v_source_version_id,
    v_source_description,
    v_source_applies_to,
    v_target_a_name,
    'omit_air_dryer'
  );

  PERFORM public._clone_basic_service_hgv_variant(
    v_source_id,
    v_source_version_id,
    v_source_description,
    v_source_applies_to,
    v_target_b_name,
    'renew_air_filter'
  );

  UPDATE public.workshop_attachment_templates
  SET is_active = false,
      updated_at = NOW()
  WHERE id = v_source_id
    AND is_active IS DISTINCT FROM false;
END $$;

DROP FUNCTION IF EXISTS public._clone_basic_service_hgv_variant(UUID, UUID, TEXT, TEXT[], TEXT, TEXT);
DROP FUNCTION IF EXISTS public._basic_service_hgv_schema_signature(UUID, TEXT);

COMMIT;
