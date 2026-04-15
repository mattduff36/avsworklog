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
      AND NOT EXISTS (
        SELECT 1
        FROM workshop_attachment_template_sections s
        INNER JOIN workshop_attachment_template_fields f
          ON f.section_id = s.id
        WHERE s.version_id = v.id
          AND f.field_key = 'inspector_signature_rectification'
      )
      AND EXISTS (
        SELECT 1
        FROM workshop_attachment_template_sections s
        INNER JOIN workshop_attachment_template_fields f
          ON f.section_id = s.id
        WHERE s.version_id = v.id
          AND f.field_key = 'signature_of_inspector'
          AND f.label = 'Signature of Inspector'
      )
      AND EXISTS (
        SELECT 1
        FROM workshop_attachment_template_sections s
        INNER JOIN workshop_attachment_template_fields f
          ON f.section_id = s.id
        WHERE s.version_id = v.id
          AND f.field_key = 'tester_signature'
          AND f.label = 'Signature of Road/Brake tester'
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

    FOR v_source_field IN
      SELECT
        field_key,
        label,
        help_text,
        field_type,
        is_required,
        options_json,
        validation_json
      FROM workshop_attachment_template_fields
      WHERE section_id = v_source_section.id
        AND field_key <> 'inspector_signature_rectification'
      ORDER BY sort_order ASC, created_at ASC
    LOOP
      v_field_index := v_field_index + 1;

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
        CASE
          WHEN v_source_field.field_key = 'signature_of_inspector' THEN 'Signature of Inspector'
          WHEN v_source_field.field_key = 'tester_signature' THEN 'Signature of Road/Brake tester'
          ELSE v_source_field.label
        END,
        v_source_field.help_text,
        v_source_field.field_type,
        v_source_field.is_required,
        v_field_index,
        v_source_field.options_json,
        v_source_field.validation_json
      );
    END LOOP;
  END LOOP;

  IF v_old_published_ids IS NOT NULL AND array_length(v_old_published_ids, 1) > 0 THEN
    UPDATE workshop_attachment_template_versions
    SET status = 'archived'
    WHERE id = ANY(v_old_published_ids);
  END IF;
END $$;
