-- Migration: Seed 6-Week Inspection HGV template (schema v2)
-- Date: 2026-04-01
-- Purpose: Provide a complex sectioned template for workshop attachments redesign

DO $$
DECLARE
  v_template_id UUID;
  v_version_id UUID;
  v_section_id UUID;
  v_next_version INTEGER;
BEGIN
  SELECT id
  INTO v_template_id
  FROM workshop_attachment_templates
  WHERE LOWER(name) = LOWER('6 Week Inspection - HGV')
  LIMIT 1;

  IF v_template_id IS NULL THEN
    INSERT INTO workshop_attachment_templates (
      name,
      description,
      is_active,
      applies_to
    )
    VALUES (
      '6 Week Inspection - HGV',
      'Structured digital version of the Goods Vehicle Inspection and Rectification Report (HGV).',
      true,
      ARRAY['hgv']::TEXT[]
    )
    RETURNING id INTO v_template_id;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM workshop_attachment_template_versions
    WHERE template_id = v_template_id
      AND status = 'published'
  ) THEN
    RETURN;
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

  -- Section 1: Vehicle and inspection details
  INSERT INTO workshop_attachment_template_sections (version_id, section_key, title, description, sort_order)
  VALUES (
    v_version_id,
    'vehicle_and_inspection_details',
    'Vehicle and Inspection Details',
    'Header information captured before checks begin.',
    1
  )
  RETURNING id INTO v_section_id;

  INSERT INTO workshop_attachment_template_fields (section_id, field_key, label, field_type, is_required, sort_order)
  VALUES
    (v_section_id, 'company_name', 'Company', 'text', true, 1),
    (v_section_id, 'address', 'Address', 'long_text', false, 2),
    (v_section_id, 'make', 'Make', 'text', true, 3),
    (v_section_id, 'registration_number', 'Registration Number', 'text', true, 4),
    (v_section_id, 'model', 'Model', 'text', false, 5),
    (v_section_id, 'body_type', 'Body Type', 'text', false, 6),
    (v_section_id, 'fleet_number', 'Fleet Number', 'text', false, 7),
    (v_section_id, 'chassis_number', 'Chassis Number', 'text', false, 8),
    (v_section_id, 'odometer_reading', 'Odometer Reading (miles/km)', 'number', true, 9),
    (v_section_id, 'inspection_date', 'Inspection Date', 'date', true, 10),
    (v_section_id, 'tachograph_calibration_date', 'Tachograph Calibration Date', 'date', false, 11),
    (v_section_id, 'tachograph_two_year_test_date', 'Tachograph 2-Year Test Date', 'date', false, 12);

  -- Section 2: Inside cab
  INSERT INTO workshop_attachment_template_sections (version_id, section_key, title, description, sort_order)
  VALUES (
    v_version_id,
    'inside_cab',
    'Inside Cab',
    'Cab controls, visibility, and warnings.',
    2
  )
  RETURNING id INTO v_section_id;

  INSERT INTO workshop_attachment_template_fields (section_id, field_key, label, field_type, is_required, sort_order, validation_json)
  VALUES
    (v_section_id, 'engine_mil', 'Engine MIL', 'marking_code', true, 1, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'reagent_adblue', 'Reagent (AdBlue)', 'marking_code', true, 2, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'dft_plate_condition', 'DfT Plate - Condition Details', 'marking_code', true, 3, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'speed_limiter_plate_condition', 'Speed Limiter Plate - Condition Details', 'marking_code', true, 4, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'seat_belts_restraints', 'Seat Belts and Supplementary Restraints', 'marking_code', true, 5, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'glass_condition', 'Condition of Glass (Screen/Windows)', 'marking_code', true, 6, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'wipers_washers', 'Windscreen Wipers and Washers', 'marking_code', true, 7, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'speedometer_tachograph', 'Speedometer/Tachograph - Operation/Seals', 'marking_code', true, 8, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'horn', 'Audible Warning - Horn', 'marking_code', true, 9, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'service_brake_operation', 'Service Brake Operation / Anti-lock Warning', 'marking_code', true, 10, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'cab_heater_demister', 'Cab Heater / Demister / Air Conditioning', 'marking_code', true, 11, '{"require_note_for":["attention","monitor"]}'::jsonb);

  -- Section 3: Cab exterior and engine compartment
  INSERT INTO workshop_attachment_template_sections (version_id, section_key, title, description, sort_order)
  VALUES (
    v_version_id,
    'cab_exterior_and_engine',
    'Cab Exterior and Engine Compartment',
    'External body condition, lights, leaks, and engine bay checks.',
    3
  )
  RETURNING id INTO v_section_id;

  INSERT INTO workshop_attachment_template_fields (section_id, field_key, label, field_type, is_required, sort_order, validation_json)
  VALUES
    (v_section_id, 'front_bumper', 'Front Bumper', 'marking_code', true, 1, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'cab_security', 'Cab Security Including Tilt Warning', 'marking_code', true, 2, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'external_mirrors', 'Mirrors and Indirect Vision Devices (External)', 'marking_code', true, 3, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'headlamps_operation', 'Headlamps - Operation/Aim/Adjustment', 'marking_code', true, 4, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'day_running_lamps', 'Day Time Running Lamps', 'marking_code', true, 5, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'engine_mountings', 'Engine / Transmission Mountings', 'marking_code', true, 6, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'oil_leaks_engine', 'Oil Leaks', 'marking_code', true, 7, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'fuel_system_engine', 'Fuel Tanks and Systems', 'marking_code', true, 8, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'exhaust_system_engine', 'Exhaust Systems', 'marking_code', true, 9, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'cooling_system_engine', 'Cooling System', 'marking_code', true, 10, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'speed_limiter_seals', 'Speed Limiter - Condition/Seals/Linkage', 'marking_code', true, 11, '{"require_note_for":["attention","monitor"]}'::jsonb);

  -- Section 4: Ground level and under/alongside vehicle
  INSERT INTO workshop_attachment_template_sections (version_id, section_key, title, description, sort_order)
  VALUES (
    v_version_id,
    'ground_level_and_under_vehicle',
    'Ground Level and Under/Alongside Vehicle',
    'Running gear, chassis, suspension, steering, transmission, and couplings.',
    4
  )
  RETURNING id INTO v_section_id;

  INSERT INTO workshop_attachment_template_fields (section_id, field_key, label, field_type, is_required, sort_order, validation_json)
  VALUES
    (v_section_id, 'road_wheels_hubs', 'Road Wheels and Hubs', 'marking_code', true, 1, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'vehicle_trailer_coupling', 'Vehicle to Trailer Coupling', 'marking_code', true, 2, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'body_security', 'Security/Condition of Body', 'marking_code', true, 3, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'mechanical_brake_components', 'Mechanical Brake Components', 'marking_code', true, 4, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'drums_discs_pads', 'Drums and Linings / Discs and Pads', 'marking_code', true, 5, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'brake_actuators_adjusters', 'Brake Actuators and Adjusters', 'marking_code', true, 6, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'brake_system_components', 'Brake Systems and Components', 'marking_code', true, 7, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'suspension_units', 'Suspension Units and Linkages', 'marking_code', true, 8, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'steering_mechanism', 'Steering Mechanism', 'marking_code', true, 9, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'power_steering', 'Power Steering and Fluid Level', 'marking_code', true, 10, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'gearbox_bell_housing', 'Gearbox and Bell Housing', 'marking_code', true, 11, '{"require_note_for":["attention","monitor"]}'::jsonb),
    (v_section_id, 'transmission_mountings', 'Transmission - Drive Line Mountings', 'marking_code', true, 12, '{"require_note_for":["attention","monitor"]}'::jsonb);

  -- Section 5: Tyres and brake metrics
  INSERT INTO workshop_attachment_template_sections (version_id, section_key, title, description, sort_order)
  VALUES (
    v_version_id,
    'tyres_and_brakes',
    'Tyres and Brake Metrics',
    'Tyre conditions, tread depth, pressures, and brake values.',
    5
  )
  RETURNING id INTO v_section_id;

  INSERT INTO workshop_attachment_template_fields (section_id, field_key, label, field_type, is_required, sort_order)
  VALUES
    (v_section_id, 'tyre_size_type', 'Size and Type of Tyres', 'text', true, 1),
    (v_section_id, 'tyre_condition', 'Condition of Tyres', 'long_text', true, 2),
    (v_section_id, 'tread_wear_pressure', 'Tread Wear / Pressure Notes', 'long_text', true, 3),
    (v_section_id, 'exhaust_emission_result', 'Exhaust Emission Result', 'text', false, 4),
    (v_section_id, 'service_brake_result', 'Service Brake Result (IM 71)', 'number', false, 5),
    (v_section_id, 'secondary_brake_result', 'Secondary Brake Result (IM 72)', 'number', false, 6),
    (v_section_id, 'parking_brake_result', 'Parking Brake Result (IM 73)', 'number', false, 7),
    (v_section_id, 'brake_temperature_assessment', 'Brake Temperature Assessment Notes', 'long_text', false, 8);

  -- Section 6: Rectification actions
  INSERT INTO workshop_attachment_template_sections (version_id, section_key, title, description, sort_order)
  VALUES (
    v_version_id,
    'rectification_actions',
    'Rectification Actions',
    'Faults requiring immediate or early attention and corrective actions.',
    6
  )
  RETURNING id INTO v_section_id;

  INSERT INTO workshop_attachment_template_fields (section_id, field_key, label, field_type, is_required, sort_order)
  VALUES
    (v_section_id, 'faults_immediate_attention', 'Faults Needing Immediate Attention', 'long_text', false, 1),
    (v_section_id, 'faults_early_attention', 'Faults Requiring Early Attention', 'long_text', false, 2),
    (v_section_id, 'actions_taken', 'Action Taken to Rectify Faults', 'long_text', false, 3),
    (v_section_id, 'rectified_by', 'Rectified By', 'text', false, 4),
    (v_section_id, 'rectification_completed_date', 'Date Completed', 'date', false, 5),
    (v_section_id, 'inspector_name_rectification', 'Inspector Name', 'text', true, 6),
    (v_section_id, 'inspector_signature_rectification', 'Inspector Signature', 'signature', true, 7);

  -- Section 7: Road/brake test and declaration
  INSERT INTO workshop_attachment_template_sections (version_id, section_key, title, description, sort_order)
  VALUES (
    v_version_id,
    'road_brake_test_and_declaration',
    'Road/Brake Test and Declaration',
    'Road speed limiter checks, load condition, comments, and tester sign-off.',
    7
  )
  RETURNING id INTO v_section_id;

  INSERT INTO workshop_attachment_template_fields (section_id, field_key, label, field_type, is_required, sort_order)
  VALUES
    (v_section_id, 'road_speed_limiter_operational', 'Road Speed Limiter Operational', 'yes_no', true, 1),
    (v_section_id, 'set_speed_kph', 'Set Speed (kph)', 'number', false, 2),
    (v_section_id, 'road_conditions', 'Road Conditions', 'text', false, 3),
    (v_section_id, 'load_condition', 'Load Condition (Laden/Unladen)', 'text', true, 4),
    (v_section_id, 'road_test_overall_comments', 'Road Test Overall Comments', 'long_text', false, 5),
    (v_section_id, 'digital_tachograph_download', 'Digital Tachograph Data Download', 'yes_no', false, 6),
    (v_section_id, 'tester_name', 'Tester Name', 'text', true, 7),
    (v_section_id, 'tester_signature', 'Tester Signature', 'signature', true, 8);

END $$;
