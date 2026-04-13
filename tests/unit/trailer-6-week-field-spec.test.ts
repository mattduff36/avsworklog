import { describe, expect, it } from 'vitest';
import {
  countTrailer6WeekFields,
  TRAILER_6_WEEK_SECTION_SPECS,
} from '@/lib/workshop-attachments/trailer-6-week-field-spec';

function listAllFieldKeys(): string[] {
  return TRAILER_6_WEEK_SECTION_SPECS.flatMap((section) => section.fields.map((field) => field.field_key));
}

describe('trailer 6-week field spec coverage', () => {
  it('contains structured page coverage across inspection, rectification, and road test sections', () => {
    expect(TRAILER_6_WEEK_SECTION_SPECS.length).toBeGreaterThanOrEqual(8);
    expect(countTrailer6WeekFields()).toBe(97);
  });

  it('contains representative trailer-specific page 1 and page 2 keys', () => {
    const keys = new Set(listAllFieldKeys());

    expect(keys.has('auto_coupling_fore_carriage_condition_security_locking_devices')).toBe(true);
    expect(keys.has('electrical_wiring_coupling_sockets_equipment_security_condition')).toBe(true);
    expect(keys.has('turntable_condition_security_operation')).toBe(true);
    expect(keys.has('tyre_position_6_pressure_psi')).toBe(true);
    expect(keys.has('trailer_safe_roadworthy_declaration')).toBe(true);
    expect(keys.has('drawing_vehicle_registration_number')).toBe(true);
    expect(keys.has('brake_temperature_ns_axle_3_c')).toBe(true);
  });

  it('keeps field keys globally unique for deterministic snapshot and response mapping', () => {
    const keys = listAllFieldKeys();
    const uniqueKeyCount = new Set(keys).size;

    expect(uniqueKeyCount).toBe(keys.length);
  });
});
