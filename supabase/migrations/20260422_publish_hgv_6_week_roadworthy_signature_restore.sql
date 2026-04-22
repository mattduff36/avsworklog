DO $$
DECLARE
  v_template_id UUID;
  v_source_version_id UUID;
  v_new_version_id UUID;
  v_next_version INTEGER;
  v_old_published_ids UUID[];
  v_source_section RECORD;
  v_source_field RECORD;
  v_new_section_id UUID;
  v_field_index INTEGER;
  v_already_published BOOLEAN;
  v_rectification_signature_present BOOLEAN;
  v_insert_after_sort_order INTEGER;
BEGIN
  SELECT id
  INTO v_template_id
  FROM workshop_attachment_templates
  WHERE LOWER(name) = LOWER('6 Week Inspection - HGV')
  LIMIT 1;

  IF v_template_id IS NULL THEN
    RETURN;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM workshop_attachment_template_versions v
    WHERE v.template_id = v_template_id
      AND v.status = 'published'
      AND EXISTS (
        SELECT 1
        FROM workshop_attachment_template_sections s
        INNER JOIN workshop_attachment_template_fields f
          ON f.section_id = s.id
        WHERE s.version_id = v.id
          AND f.field_key = 'vehicle_safe_roadworthy_declaration'
          AND f.is_required = true
      )
      AND EXISTS (
        SELECT 1
        FROM workshop_attachment_template_sections s
        INNER JOIN workshop_attachment_template_fields f
          ON f.section_id = s.id
        WHERE s.version_id = v.id
          AND f.field_key = 'inspector_signature_rectification'
          AND f.label = 'Signature'
          AND f.field_type = 'signature'
          AND f.is_required = true
      )
  )
  INTO v_already_published;

  IF v_already_published THEN
    RETURN;
  END IF;

  SELECT id
  INTO v_source_version_id
  FROM workshop_attachment_template_versions
  WHERE template_id = v_template_id
    AND status = 'published'
  ORDER BY version_number DESC
  LIMIT 1;

  IF v_source_version_id IS NULL THEN
    RETURN;
  END IF;

  SELECT ARRAY_AGG(id)
  INTO v_old_published_ids
  FROM workshop_attachment_template_versions
  WHERE template_id = v_template_id
    AND status = 'published';

  SELECT COALESCE(MAX(version_number), 0) + 1
  INTO v_next_version
  FROM workshop_attachment_template_versions
  WHERE template_id = v_template_id;

  INSERT INTO workshop_attachment_template_versions (
    template_id,
    version_number,
    status
  )
  VALUES (
    v_template_id,
    v_next_version,
    'published'
  )
  RETURNING id INTO v_new_version_id;

  FOR v_source_section IN
    SELECT id, section_key, title, description, sort_order
    FROM workshop_attachment_template_sections
    WHERE version_id = v_source_version_id
    ORDER BY sort_order ASC, created_at ASC
  LOOP
    INSERT INTO workshop_attachment_template_sections (
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

    v_field_index := 0;
    v_rectification_signature_present := false;
    v_insert_after_sort_order := NULL;

    FOR v_source_field IN
      SELECT
        field_key,
        label,
        help_text,
        field_type,
        is_required,
        sort_order,
        options_json,
        validation_json
      FROM workshop_attachment_template_fields
      WHERE section_id = v_source_section.id
      ORDER BY sort_order ASC, created_at ASC
    LOOP
      v_field_index := v_field_index + 1;

      IF v_source_section.section_key = 'rectification_actions'
         AND v_source_field.field_key = 'inspector_signature_rectification' THEN
        v_rectification_signature_present := true;
      END IF;

      INSERT INTO workshop_attachment_template_fields (
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
        v_source_field.field_key,
        v_source_field.label,
        v_source_field.help_text,
        v_source_field.field_type,
        CASE
          WHEN v_source_section.section_key = 'rectification_actions'
            AND v_source_field.field_key = 'vehicle_safe_roadworthy_declaration'
            THEN true
          ELSE v_source_field.is_required
        END,
        v_field_index,
        v_source_field.options_json,
        v_source_field.validation_json
      );

      IF v_source_section.section_key = 'rectification_actions'
         AND v_source_field.field_key = 'inspector_name_rectification' THEN
        v_insert_after_sort_order := v_field_index;
      END IF;
    END LOOP;

    IF v_source_section.section_key = 'rectification_actions'
       AND NOT v_rectification_signature_present THEN
      IF v_insert_after_sort_order IS NULL THEN
        v_insert_after_sort_order := v_field_index;
      END IF;

      UPDATE workshop_attachment_template_fields
      SET sort_order = sort_order + 1
      WHERE section_id = v_new_section_id
        AND sort_order > v_insert_after_sort_order;

      INSERT INTO workshop_attachment_template_fields (
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
        'inspector_signature_rectification',
        'Signature',
        NULL,
        'signature',
        true,
        v_insert_after_sort_order + 1,
        NULL,
        NULL
      );
    END IF;
  END LOOP;

  IF v_old_published_ids IS NOT NULL AND array_length(v_old_published_ids, 1) > 0 THEN
    UPDATE workshop_attachment_template_versions
    SET status = 'archived'
    WHERE id = ANY(v_old_published_ids);
  END IF;
END $$;
