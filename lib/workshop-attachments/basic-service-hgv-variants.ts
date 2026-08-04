export interface BasicServiceChecklistField {
  field_key: string;
  label: string;
  field_type: string;
  is_required: boolean;
  sort_order: number;
  help_text: string | null;
  options_json: unknown;
  validation_json: unknown;
}

export type BasicServiceCloneMode = 'omit_air_dryer' | 'renew_air_filter';

/**
 * Transform a Basic Service (HGV) checklist field list into variant A/B.
 * Preserves source sort_order and metadata except for the requested edits.
 */
export function transformBasicServiceChecklistFields(
  sourceFields: BasicServiceChecklistField[],
  mode: BasicServiceCloneMode,
): BasicServiceChecklistField[] {
  const ordered = [...sourceFields].sort((a, b) => {
    if (a.sort_order !== b.sort_order) {
      return a.sort_order - b.sort_order;
    }
    return a.field_key.localeCompare(b.field_key);
  });

  return ordered
    .filter((field) => !(mode === 'omit_air_dryer' && field.field_key === 'renew_air_dryer_filter'))
    .map((field) => {
      if (mode === 'renew_air_filter' && field.field_key === 'clean_out_air_filter') {
        return {
          ...field,
          field_key: 'renew_air_filter',
          label: 'Renew air filter',
        };
      }
      return { ...field };
    });
}

export function buildBasicServiceFieldSignature(fields: BasicServiceChecklistField[]): string {
  return fields
    .map((field) =>
      [
        field.field_key,
        field.label,
        field.field_type,
        String(field.is_required),
        String(field.sort_order),
        field.help_text ?? '',
        JSON.stringify(field.options_json ?? null),
        JSON.stringify(field.validation_json ?? null),
      ].join(':'),
    )
    .join('|');
}
