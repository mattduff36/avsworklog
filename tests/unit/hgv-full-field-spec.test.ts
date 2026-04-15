import { describe, expect, it } from 'vitest';
import {
  countHgv6WeekFullFields,
  HGV_6_WEEK_FULL_SECTION_SPECS,
} from '@/lib/workshop-attachments/hgv-full-field-spec';

function listAllFieldKeys(): string[] {
  return HGV_6_WEEK_FULL_SECTION_SPECS.flatMap((section) => section.fields.map((field) => field.field_key));
}

describe('HGV full field spec coverage', () => {
  it('contains strict all-pages field coverage above legacy size', () => {
    expect(HGV_6_WEEK_FULL_SECTION_SPECS.length).toBeGreaterThanOrEqual(7);
    expect(countHgv6WeekFullFields()).toBe(222);
  });

  it('contains representative page 2 and page 3 keys', () => {
    const keys = new Set(listAllFieldKeys());

    expect(keys.has('mechanical_brake_components')).toBe(true);
    expect(keys.has('rear_lamps_outline_markers_number_plate_lamp')).toBe(true);
    expect(keys.has('rectification_fault_number')).toBe(true);
    expect(keys.has('brake_temperature_ns_axle_4_c')).toBe(true);
    expect(keys.has('digital_tachograph_download')).toBe(true);
  });

  it('keeps field keys globally unique for deterministic backfill mapping', () => {
    const keys = listAllFieldKeys();
    const uniqueKeyCount = new Set(keys).size;

    expect(uniqueKeyCount).toBe(keys.length);
  });

  it('keeps only one rectification signature and updated sign-off labels', () => {
    const keys = new Set(listAllFieldKeys());
    const rectificationSection = HGV_6_WEEK_FULL_SECTION_SPECS.find(
      (section) => section.section_key === 'rectification_actions',
    );
    const roadBrakeSection = HGV_6_WEEK_FULL_SECTION_SPECS.find(
      (section) => section.section_key === 'road_brake_test_and_declaration',
    );

    expect(keys.has('inspector_signature_rectification')).toBe(false);
    expect(
      rectificationSection?.fields.find((field) => field.field_key === 'signature_of_inspector')?.label,
    ).toBe('Signature of Inspector');
    expect(
      roadBrakeSection?.fields.find((field) => field.field_key === 'tester_signature')?.label,
    ).toBe('Signature of Road/Brake tester');
  });
});
