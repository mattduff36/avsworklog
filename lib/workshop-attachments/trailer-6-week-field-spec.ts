export interface TrailerFieldSpec {
  field_key: string;
  label: string;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature';
  is_required: boolean;
}

export interface TrailerSectionSpec {
  section_key: string;
  title: string;
  description: string;
  sort_order: number;
  fields: TrailerFieldSpec[];
}

export const TRAILER_6_WEEK_SECTION_SPECS: TrailerSectionSpec[] = [
  {
    section_key: 'trailer_and_inspection_details',
    title: 'Trailer and Inspection Details',
    description: 'Header details captured before the trailer inspection checklist begins.',
    sort_order: 1,
    fields: [
      { field_key: 'company_name', label: 'Company', field_type: 'text', is_required: true },
      { field_key: 'address', label: 'Address', field_type: 'long_text', is_required: false },
      { field_key: 'chassis_number', label: 'Chassis number', field_type: 'text', is_required: true },
      { field_key: 'inspection_date', label: 'Date of inspection', field_type: 'date', is_required: true },
    ],
  },
  {
    section_key: 'under_alongside_trailer',
    title: 'Under/Alongside Trailer',
    description: 'Trailer body, couplings, structure, and ancillary equipment checks from page 1.',
    sort_order: 2,
    fields: [
      { field_key: 'dft_plate_position_detail', label: 'DfT plate - position/detail', field_type: 'marking_code', is_required: true },
      { field_key: 'bumpers_security_condition_dimension', label: 'Bumpers - security/condition/dimensions', field_type: 'marking_code', is_required: true },
      { field_key: 'rear_underrun_device_security_condition_dimension', label: 'Rear underrun device - security/condition/dimensions', field_type: 'marking_code', is_required: true },
      { field_key: 'protective_sideguards_security_condition_dimension', label: 'Protective sideguards - security/condition/dimensions', field_type: 'marking_code', is_required: true },
      { field_key: 'spare_wheel_and_carrier_security_condition_wheel_attachment', label: 'Spare wheel and carrier - security/condition/wheel attachment', field_type: 'marking_code', is_required: true },
      { field_key: 'auto_coupling_fore_carriage_condition_security_locking_devices', label: 'Auto coupling/fore carriage - condition/security/locking devices', field_type: 'marking_code', is_required: true },
      { field_key: 'body_security_displacement_condition_security_of_mountings', label: 'Body - security/displacement/condition/security of mountings', field_type: 'marking_code', is_required: true },
      { field_key: 'body_condition_damage_cargo_tank_leaks', label: 'Body - condition/damage/cargo tank leaks', field_type: 'marking_code', is_required: true },
      { field_key: 'wings_flaps_spray_suppression_wheel_arches_condition_security_compliance', label: 'Wings/flaps/spray suppression/wheel arches - condition/security/compliance', field_type: 'marking_code', is_required: true },
      { field_key: 'demountable_body_equipment', label: 'Demountable body equipment', field_type: 'marking_code', is_required: true },
      { field_key: 'security_of_body_containers_and_crane_support_legs', label: 'Security of body, containers and crane support legs', field_type: 'marking_code', is_required: true },
      { field_key: 'tipping_rams_pivots_controls', label: 'Tipping rams, pivots and controls', field_type: 'marking_code', is_required: true },
      { field_key: 'loading_aids_lifts_tracks', label: 'Loading aids (lifts and tracks, etc)', field_type: 'marking_code', is_required: true },
      { field_key: 'cranes_gantries', label: 'Cranes, gantries', field_type: 'marking_code', is_required: true },
      { field_key: 'discharge_equipment', label: 'Discharge equipment', field_type: 'marking_code', is_required: true },
      { field_key: 'other_ancillary_equipment', label: 'Other ancillary equipment', field_type: 'marking_code', is_required: true },
      { field_key: 'chassis_condition', label: 'Chassis (including sub-frames) - condition/deformation', field_type: 'marking_code', is_required: true },
      { field_key: 'electrical_wiring_coupling_sockets_equipment_security_condition', label: 'Electrical wiring, coupling sockets and equipment - security/condition', field_type: 'marking_code', is_required: true },
    ],
  },
  {
    section_key: 'brakes',
    title: 'Brakes',
    description: 'Trailer braking system inspection items from page 1.',
    sort_order: 3,
    fields: [
      { field_key: 'mechanical_brake_components_security_condition_adjustment_leaks', label: 'Mechanical brake components - security/condition/adjustment/leaks', field_type: 'marking_code', is_required: true },
      { field_key: 'brake_drums_and_linings_security_condition_adjustment_leaks', label: 'Brake drums and linings - security/condition/adjustment/leaks', field_type: 'marking_code', is_required: true },
      { field_key: 'brake_actuators_and_adjusters_security_condition_adjustment_leaks', label: 'Brake actuators and adjusters - security/condition/adjustment/leaks', field_type: 'marking_code', is_required: true },
      { field_key: 'braking_systems_and_components', label: 'Braking systems and components', field_type: 'marking_code', is_required: true },
      { field_key: 'electronic_braking_stability_control_systems_operation_warning', label: 'Electronic braking/stability control systems - operation/warning', field_type: 'marking_code', is_required: true },
      { field_key: 'anti_lock_equipment_warning_lights_service_brake_operation', label: 'Anti-lock equipment and warning lights/service brake operation', field_type: 'marking_code', is_required: true },
      { field_key: 'parking_brake_function_leaks_compliance', label: 'Parking brake - function/leaks/compliance', field_type: 'marking_code', is_required: true },
      { field_key: 'emergency_brake_function_leaks', label: 'Emergency brake - function/leaks', field_type: 'marking_code', is_required: true },
      { field_key: 'hand_operated_brake_control_valves_function_condition', label: 'Hand operated brake control valves - function/condition', field_type: 'marking_code', is_required: true },
      { field_key: 'additional_braking_devices', label: 'Additional braking devices', field_type: 'marking_code', is_required: true },
    ],
  },
  {
    section_key: 'markings_lamps_and_reflectors',
    title: 'Markings, Lamps, and Reflectors',
    description: 'Trailer markings and lighting checks from page 1.',
    sort_order: 4,
    fields: [
      { field_key: 'rear_markings_reflective_security_condition_position_specification', label: 'Rear markings (reflective) - security/condition/position/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'conspicuity_markings_security_condition_position_specification', label: 'Conspicuity markings - security/condition/position/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'front_lamps_and_outline_markers', label: 'Front lamps and outline markers', field_type: 'marking_code', is_required: true },
      { field_key: 'rear_lamps_and_outline_markers_position_operation_specification', label: 'Rear lamps and outline markers - position/operation/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'number_plate_lamps_position_operation_specification', label: 'Number plate lamp(s) - position/operation/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'rear_fog_lamps_position_operation_specification', label: 'Rear fog lamp(s) - position/operation/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'reflectors_front_rear_side_security_condition_position_specification', label: 'Reflectors (front, rear, side) - security/condition/position/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'direction_hazard_indicators_position_operation_specification', label: 'Direction/hazard indicators - position/operation/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'stop_lamps_position_operation_specification', label: 'Stop lamps - position/operation/specification', field_type: 'marking_code', is_required: true },
      { field_key: 'reversing_lamps', label: 'Reversing lamp(s)', field_type: 'marking_code', is_required: true },
      { field_key: 'other_lamps', label: 'Other lamps', field_type: 'marking_code', is_required: true },
    ],
  },
  {
    section_key: 'suspension_running_gear_and_steering',
    title: 'Suspension, Running Gear, and Steering',
    description: 'Suspension, wheel, and drawbar steering items from page 1.',
    sort_order: 5,
    fields: [
      { field_key: 'suspension_pins_and_bushes', label: 'Suspension pins and bushes', field_type: 'marking_code', is_required: true },
      { field_key: 'suspension_spring_units_and_links_condition', label: 'Suspension spring units and links - condition', field_type: 'marking_code', is_required: true },
      { field_key: 'spring_units_links_and_subframes_attachment', label: 'Spring units, links and sub-frames - attachment', field_type: 'marking_code', is_required: true },
      { field_key: 'shock_absorbers_dampers', label: 'Shock absorbers (dampers)', field_type: 'marking_code', is_required: true },
      { field_key: 'axle_lift_devices', label: 'Axle lift devices', field_type: 'marking_code', is_required: true },
      { field_key: 'self_steer_equipment_wear_security_condition_adjustment', label: 'Self-steer equipment - wear/security/condition/adjustment', field_type: 'marking_code', is_required: true },
      { field_key: 'steering_mechanisms_wear_security_condition_operation_leaks', label: 'Steering mechanisms - wear/security/condition/operation/leaks', field_type: 'marking_code', is_required: true },
      { field_key: 'turntable_condition_security_operation', label: 'Turntable - condition/security/operation', field_type: 'marking_code', is_required: true },
      { field_key: 'road_wheels_and_hubs_condition_security', label: 'Road wheels and hubs - condition/security', field_type: 'marking_code', is_required: true },
      { field_key: 'wheel_bearings_and_seals', label: 'Wheel bearings and seals', field_type: 'marking_code', is_required: true },
    ],
  },
  {
    section_key: 'tyres',
    title: 'Tyres',
    description: 'Trailer tyre inspection notes and tread/pressure measurements from page 1.',
    sort_order: 6,
    fields: [
      { field_key: 'tyre_condition_wear_damage_inflation', label: 'Condition of tyres - wear/damage/inflation', field_type: 'marking_code', is_required: true },
      { field_key: 'tread_wear_pressure_notes', label: 'TREAD WEAR/PRESSURE notes', field_type: 'long_text', is_required: true },
      { field_key: 'tyre_position_1_tread_mm', label: 'Tyre position 1 tread (mm)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_1_pressure_psi', label: 'Tyre position 1 pressure (psi)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_2_tread_mm', label: 'Tyre position 2 tread (mm)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_2_pressure_psi', label: 'Tyre position 2 pressure (psi)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_3_tread_mm', label: 'Tyre position 3 tread (mm)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_3_pressure_psi', label: 'Tyre position 3 pressure (psi)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_4_tread_mm', label: 'Tyre position 4 tread (mm)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_4_pressure_psi', label: 'Tyre position 4 pressure (psi)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_5_tread_mm', label: 'Tyre position 5 tread (mm)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_5_pressure_psi', label: 'Tyre position 5 pressure (psi)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_6_tread_mm', label: 'Tyre position 6 tread (mm)', field_type: 'number', is_required: false },
      { field_key: 'tyre_position_6_pressure_psi', label: 'Tyre position 6 pressure (psi)', field_type: 'number', is_required: false },
    ],
  },
  {
    section_key: 'rectification',
    title: 'Part 2: Rectification',
    description: 'Fault details, actions taken, and trailer rectification sign-off from page 2.',
    sort_order: 7,
    fields: [
      { field_key: 'faults_immediate_attention', label: 'Needing immediate attention', field_type: 'long_text', is_required: false },
      { field_key: 'faults_early_attention', label: 'Less urgent - for early attention', field_type: 'long_text', is_required: false },
      { field_key: 'rectification_im_number', label: 'IM no', field_type: 'text', is_required: false },
      { field_key: 'rectification_fault_number', label: 'Fault no', field_type: 'text', is_required: false },
      { field_key: 'actions_taken', label: 'Action taken to rectify faults', field_type: 'long_text', is_required: false },
      { field_key: 'rectified_by', label: 'Rectified by', field_type: 'text', is_required: false },
      { field_key: 'driver_defect_report_items', label: 'Faults numbered here are Driver Defect Report items', field_type: 'long_text', is_required: false },
      { field_key: 'trailer_safe_roadworthy_declaration', label: 'Trailer now in a safe and roadworthy condition', field_type: 'yes_no', is_required: false },
      { field_key: 'rectification_completed_date', label: 'Date completed', field_type: 'date', is_required: false },
      { field_key: 'inspector_signature', label: 'Inspector signature', field_type: 'signature', is_required: true },
      { field_key: 'inspector_name', label: 'Name of inspector', field_type: 'text', is_required: true },
      { field_key: 'inspector_position', label: 'Position', field_type: 'text', is_required: false },
    ],
  },
  {
    section_key: 'road_brake_test_report',
    title: 'Part 3: Road/Brake Test Report',
    description: 'Trailer road test, brake performance, and braking assessment fields from page 2.',
    sort_order: 8,
    fields: [
      { field_key: 'road_conditions', label: 'Road conditions', field_type: 'text', is_required: false },
      { field_key: 'drawing_vehicle_registration_number', label: 'Reg no of drawing vehicle', field_type: 'text', is_required: false },
      { field_key: 'load_condition', label: 'Load condition of vehicle (Laden/Unladen)', field_type: 'text', is_required: true },
      { field_key: 'decelerometer_test_result', label: 'Decelerometer test', field_type: 'text', is_required: false },
      { field_key: 'roller_brake_test_result', label: 'Roller brake test', field_type: 'text', is_required: false },
      { field_key: 'service_brake_result', label: 'Service [IM no 71]', field_type: 'number', is_required: false },
      { field_key: 'secondary_brake_result', label: 'Secondary [IM no 72]', field_type: 'number', is_required: false },
      { field_key: 'parking_brake_result', label: 'Parking [IM no 73]', field_type: 'number', is_required: false },
      { field_key: 'brake_performance_comments', label: 'Brake performance comments', field_type: 'long_text', is_required: false },
      { field_key: 'brake_temperature_os_axle_1_c', label: 'Brake temperature O/S axle 1 (C)', field_type: 'number', is_required: false },
      { field_key: 'brake_temperature_os_axle_2_c', label: 'Brake temperature O/S axle 2 (C)', field_type: 'number', is_required: false },
      { field_key: 'brake_temperature_os_axle_3_c', label: 'Brake temperature O/S axle 3 (C)', field_type: 'number', is_required: false },
      { field_key: 'brake_temperature_ns_axle_1_c', label: 'Brake temperature N/S axle 1 (C)', field_type: 'number', is_required: false },
      { field_key: 'brake_temperature_ns_axle_2_c', label: 'Brake temperature N/S axle 2 (C)', field_type: 'number', is_required: false },
      { field_key: 'brake_temperature_ns_axle_3_c', label: 'Brake temperature N/S axle 3 (C)', field_type: 'number', is_required: false },
      { field_key: 'road_test_overall_comments', label: 'Road test - overall comments', field_type: 'long_text', is_required: false },
      { field_key: 'tester_signature', label: 'Tester signature', field_type: 'signature', is_required: true },
      { field_key: 'date_of_braking_assessment', label: 'Date of braking assessment', field_type: 'date', is_required: false },
    ],
  },
];

export function countTrailer6WeekFields(): number {
  return TRAILER_6_WEEK_SECTION_SPECS.reduce((total, section) => total + section.fields.length, 0);
}
