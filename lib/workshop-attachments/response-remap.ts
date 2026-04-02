export interface ExistingAttachmentResponse {
  field_key: string;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

export interface ResponseRemapTarget {
  field_id: string;
  section_key: string;
}

export interface RemappedAttachmentResponse extends ExistingAttachmentResponse {
  field_id: string;
  section_key: string;
}

export interface ResponseRemapResult {
  mapped: RemappedAttachmentResponse[];
  unmappedKeys: string[];
}

export function remapResponsesByFieldKey(
  existingResponses: ExistingAttachmentResponse[],
  fieldTargets: Map<string, ResponseRemapTarget>,
): ResponseRemapResult {
  const mapped: RemappedAttachmentResponse[] = [];
  const unmappedKeys: string[] = [];

  for (const response of existingResponses) {
    const target = fieldTargets.get(response.field_key);
    if (!target) {
      unmappedKeys.push(response.field_key);
      continue;
    }

    mapped.push({
      field_id: target.field_id,
      section_key: target.section_key,
      field_key: response.field_key,
      response_value: response.response_value,
      response_json: response.response_json,
    });
  }

  return { mapped, unmappedKeys };
}
