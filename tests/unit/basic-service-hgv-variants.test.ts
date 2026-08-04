import { describe, expect, it } from 'vitest';
import {
  buildBasicServiceFieldSignature,
  transformBasicServiceChecklistFields,
  type BasicServiceChecklistField,
} from '@/lib/workshop-attachments/basic-service-hgv-variants';

const SOURCE_FIELDS: BasicServiceChecklistField[] = [
  {
    field_key: 'drain_refill_engine_oil',
    label: 'Drain and refill engine oil',
    field_type: 'yes_no',
    is_required: true,
    sort_order: 1,
    help_text: null,
    options_json: null,
    validation_json: null,
  },
  {
    field_key: 'clean_out_air_filter',
    label: 'Clean out air filter',
    field_type: 'yes_no',
    is_required: true,
    sort_order: 5,
    help_text: null,
    options_json: null,
    validation_json: null,
  },
  {
    field_key: 'renew_air_dryer_filter',
    label: 'Renew air dryer filter',
    field_type: 'yes_no',
    is_required: true,
    sort_order: 6,
    help_text: null,
    options_json: null,
    validation_json: null,
  },
  {
    field_key: 'check_transmission_oil_levels',
    label: 'Check transmission oil levels',
    field_type: 'yes_no',
    is_required: true,
    sort_order: 7,
    help_text: null,
    options_json: null,
    validation_json: null,
  },
];

describe('basic service HGV variant transforms', () => {
  it('WAT-CLONE-002: omits renew_air_dryer_filter and preserves source sort_order', () => {
    const result = transformBasicServiceChecklistFields(SOURCE_FIELDS, 'omit_air_dryer');

    expect(result.map((field) => field.field_key)).toEqual([
      'drain_refill_engine_oil',
      'clean_out_air_filter',
      'check_transmission_oil_levels',
    ]);
    expect(result.find((field) => field.field_key === 'check_transmission_oil_levels')?.sort_order).toBe(7);
    expect(result.some((field) => field.field_key === 'renew_air_dryer_filter')).toBe(false);
  });

  it('WAT-CLONE-003: renames clean_out_air_filter to renew_air_filter', () => {
    const result = transformBasicServiceChecklistFields(SOURCE_FIELDS, 'renew_air_filter');

    expect(result.map((field) => `${field.field_key}:${field.label}:${field.sort_order}`)).toEqual([
      'drain_refill_engine_oil:Drain and refill engine oil:1',
      'renew_air_filter:Renew air filter:5',
      'renew_air_dryer_filter:Renew air dryer filter:6',
      'check_transmission_oil_levels:Check transmission oil levels:7',
    ]);
    expect(result.some((field) => field.field_key === 'clean_out_air_filter')).toBe(false);
  });

  it('builds stable signatures for exact schema comparison', () => {
    const a = transformBasicServiceChecklistFields(SOURCE_FIELDS, 'omit_air_dryer');
    const b = transformBasicServiceChecklistFields(SOURCE_FIELDS, 'renew_air_filter');

    expect(buildBasicServiceFieldSignature(a)).toContain('check_transmission_oil_levels:Check transmission oil levels:yes_no:true:7');
    expect(buildBasicServiceFieldSignature(b)).toContain('renew_air_filter:Renew air filter:yes_no:true:5');
    expect(buildBasicServiceFieldSignature(a)).not.toEqual(buildBasicServiceFieldSignature(b));
  });
});
