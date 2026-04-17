-- Migration: Publish HGV service templates (v2)
-- Date: 2026-04-17
-- Purpose: Add client-provided Full Service and Basic Service HGV attachment templates

DO $$
DECLARE
  v_templates JSONB := $json$
[
  {
    "name": "Full Service (HGV)",
    "description": "Client-provided full HGV service checklist based on the major service sheet. Interval: every 100,000 km.",
    "applies_to": ["hgv"],
    "match_field_key": "drain_refill_engine_oil",
    "sections": [
      {
        "section_key": "service_details",
        "title": "Service Details",
        "description": "Record the service details before completing the checklist. Service interval: every 100,000 km.",
        "fields": [
          { "field_key": "service_date", "label": "Service date", "field_type": "date", "is_required": true },
          { "field_key": "current_km", "label": "Current km", "field_type": "number", "is_required": true },
          { "field_key": "service_notes", "label": "Service notes", "field_type": "long_text", "is_required": false }
        ]
      },
      {
        "section_key": "service_checklist",
        "title": "Service Checklist",
        "description": "Complete each item from the client-provided full HGV service sheet.",
        "fields": [
          { "field_key": "drain_refill_engine_oil", "label": "Drain and refill engine oil", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_oil_filter", "label": "Renew oil filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_oil_spinner_filter", "label": "Renew oil spinner filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_fuel_filters", "label": "Renew fuel filters", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_air_filter", "label": "Renew air filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_air_dryer_filter", "label": "Renew air dryer filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_cab_pollen_filter", "label": "Renew cab pollen filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "replace_power_steering_filter", "label": "Replace power steering filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_adblue_filter", "label": "Renew AdBlue filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "drain_refill_gearbox_oil", "label": "Drain and refill gearbox oil", "field_type": "yes_no", "is_required": true },
          { "field_key": "replace_gearbox_transmission_filter", "label": "Replace gearbox transmission filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "drain_refill_diff_oils", "label": "Drain and refill diff oils", "field_type": "yes_no", "is_required": true },
          { "field_key": "replace_diff_transmission_filters", "label": "Replace diff transmission filters", "field_type": "yes_no", "is_required": true }
        ]
      },
      {
        "section_key": "completion_and_sign_off",
        "title": "Completion and Sign-Off",
        "description": "Capture any follow-up notes and final sign-off for the completed service.",
        "fields": [
          { "field_key": "follow_up_notes", "label": "Follow-up notes", "field_type": "long_text", "is_required": false },
          { "field_key": "vehicle_safe_roadworthy", "label": "Vehicle safe and roadworthy", "field_type": "yes_no", "is_required": true },
          { "field_key": "technician_signature", "label": "Technician signature", "field_type": "signature", "is_required": true }
        ]
      }
    ]
  },
  {
    "name": "Basic Service (HGV)",
    "description": "Client-provided basic HGV service checklist based on the small service sheet. Interval: every 25,000 km.",
    "applies_to": ["hgv"],
    "match_field_key": "drain_refill_engine_oil",
    "sections": [
      {
        "section_key": "service_details",
        "title": "Service Details",
        "description": "Record the service details before completing the checklist. Service interval: every 25,000 km.",
        "fields": [
          { "field_key": "service_date", "label": "Service date", "field_type": "date", "is_required": true },
          { "field_key": "current_km", "label": "Current km", "field_type": "number", "is_required": true },
          { "field_key": "service_notes", "label": "Service notes", "field_type": "long_text", "is_required": false }
        ]
      },
      {
        "section_key": "service_checklist",
        "title": "Service Checklist",
        "description": "Complete each item from the client-provided basic HGV service sheet.",
        "fields": [
          { "field_key": "drain_refill_engine_oil", "label": "Drain and refill engine oil", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_oil_filter", "label": "Renew oil filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_oil_spinner_filter", "label": "Renew oil spinner filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_fuel_filters", "label": "Renew fuel filters", "field_type": "yes_no", "is_required": true },
          { "field_key": "clean_out_air_filter", "label": "Clean out air filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "renew_air_dryer_filter", "label": "Renew air dryer filter", "field_type": "yes_no", "is_required": true },
          { "field_key": "check_transmission_oil_levels", "label": "Check transmission oil levels", "field_type": "yes_no", "is_required": true }
        ]
      },
      {
        "section_key": "completion_and_sign_off",
        "title": "Completion and Sign-Off",
        "description": "Capture any follow-up notes and final sign-off for the completed service.",
        "fields": [
          { "field_key": "follow_up_notes", "label": "Follow-up notes", "field_type": "long_text", "is_required": false },
          { "field_key": "vehicle_safe_roadworthy", "label": "Vehicle safe and roadworthy", "field_type": "yes_no", "is_required": true },
          { "field_key": "technician_signature", "label": "Technician signature", "field_type": "signature", "is_required": true }
        ]
      }
    ]
  }
]
$json$::JSONB;
  template_item JSONB;
  section_item JSONB;
  field_item JSONB;
  v_template_id UUID;
  v_version_id UUID;
  v_section_id UUID;
  v_next_version INTEGER;
  v_section_index INTEGER;
  v_field_index INTEGER;
  v_has_published_template BOOLEAN;
BEGIN
  FOR template_item IN SELECT * FROM jsonb_array_elements(v_templates)
  LOOP
    SELECT id
    INTO v_template_id
    FROM workshop_attachment_templates
    WHERE LOWER(name) = LOWER(template_item->>'name')
    LIMIT 1;

    IF v_template_id IS NULL THEN
      INSERT INTO workshop_attachment_templates (
        name,
        description,
        is_active,
        applies_to
      )
      VALUES (
        template_item->>'name',
        NULLIF(template_item->>'description', ''),
        true,
        ARRAY(
          SELECT jsonb_array_elements_text(template_item->'applies_to')
        )::TEXT[]
      )
      RETURNING id INTO v_template_id;
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM workshop_attachment_template_versions v
      INNER JOIN workshop_attachment_template_sections s ON s.version_id = v.id
      INNER JOIN workshop_attachment_template_fields f ON f.section_id = s.id
      WHERE v.template_id = v_template_id
        AND v.status = 'published'
        AND f.field_key = template_item->>'match_field_key'
    )
    INTO v_has_published_template;

    IF v_has_published_template THEN
      CONTINUE;
    END IF;

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
    RETURNING id INTO v_version_id;

    v_section_index := 0;
    FOR section_item IN SELECT * FROM jsonb_array_elements(template_item->'sections')
    LOOP
      v_section_index := v_section_index + 1;

      INSERT INTO workshop_attachment_template_sections (
        version_id,
        section_key,
        title,
        description,
        sort_order
      )
      VALUES (
        v_version_id,
        section_item->>'section_key',
        section_item->>'title',
        NULLIF(section_item->>'description', ''),
        v_section_index
      )
      RETURNING id INTO v_section_id;

      v_field_index := 0;
      FOR field_item IN SELECT * FROM jsonb_array_elements(section_item->'fields')
      LOOP
        v_field_index := v_field_index + 1;

        INSERT INTO workshop_attachment_template_fields (
          section_id,
          field_key,
          label,
          help_text,
          field_type,
          is_required,
          sort_order
        )
        VALUES (
          v_section_id,
          field_item->>'field_key',
          field_item->>'label',
          NULLIF(field_item->>'help_text', ''),
          (field_item->>'field_type')::workshop_attachment_field_type,
          COALESCE((field_item->>'is_required')::BOOLEAN, false),
          v_field_index
        );
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
