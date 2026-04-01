import type { AttachmentSchemaSection } from '@/types/workshop-attachments-v2';

export interface SchemaValidationResponse {
  section_key: string;
  field_key: string;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function isSignatureValid(responseJson: Record<string, unknown> | null | undefined): boolean {
  if (!responseJson) return false;
  const dataUrl = normalizeValue(responseJson.data_url);
  const signedByName = normalizeValue(responseJson.signed_by_name);
  const signedAt = normalizeValue(responseJson.signed_at);
  return dataUrl.length > 0 && signedByName.length > 0 && signedAt.length > 0;
}

function requiresMarkingCodeNote(
  field: AttachmentSchemaSection['fields'][number],
  responseValue: string,
  responseJson: Record<string, unknown> | null | undefined,
): boolean {
  if (field.field_type !== 'marking_code') return false;
  if (!field.validation_json || !Array.isArray(field.validation_json.require_note_for)) return false;

  const requiredValues = (field.validation_json.require_note_for as unknown[])
    .map((entry) => normalizeValue(entry))
    .filter(Boolean);

  if (!requiredValues.includes(responseValue)) return false;
  const note = normalizeValue(responseJson?.note);
  return note.length === 0;
}

export function validateRequiredSchemaResponses(
  sections: AttachmentSchemaSection[],
  responses: SchemaValidationResponse[],
): string[] {
  const responseMap = new Map<string, SchemaValidationResponse>(
    responses.map((response) => [`${response.section_key}::${response.field_key}`, response]),
  );
  const errors: string[] = [];

  sections.forEach((section) => {
    section.fields.forEach((field) => {
      if (!field.is_required) return;
      const key = `${section.section_key}::${field.field_key}`;
      const response = responseMap.get(key);
      const responseValue = normalizeValue(response?.response_value);

      if (field.field_type === 'signature') {
        if (!isSignatureValid(response?.response_json)) {
          errors.push(`${section.title}: ${field.label} signature is required.`);
        }
        return;
      }

      if (responseValue.length === 0) {
        errors.push(`${section.title}: ${field.label} is required.`);
        return;
      }

      if (requiresMarkingCodeNote(field, responseValue, response?.response_json)) {
        errors.push(`${section.title}: ${field.label} requires a note for "${responseValue}".`);
      }
    });
  });

  return errors;
}
