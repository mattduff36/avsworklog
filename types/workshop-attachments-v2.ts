export interface AttachmentSchemaFieldOption {
  value: string;
  label: string;
}

export interface AttachmentSchemaField {
  id: string;
  field_key: string;
  label: string;
  help_text: string | null;
  field_type:
    | 'marking_code'
    | 'text'
    | 'long_text'
    | 'number'
    | 'date'
    | 'yes_no'
    | 'signature';
  is_required: boolean;
  sort_order: number;
  options_json: Record<string, unknown> | null;
  validation_json: Record<string, unknown> | null;
}

export interface AttachmentSchemaSection {
  id: string;
  section_key: string;
  title: string;
  description: string | null;
  sort_order: number;
  fields: AttachmentSchemaField[];
}

export interface AttachmentSchemaSnapshotPayload {
  version_id: string | null;
  template_id: string;
  generated_at: string;
  sections: AttachmentSchemaSection[];
}

export interface AttachmentSchemaSnapshot {
  id: string;
  attachment_id: string;
  template_version_id: string | null;
  snapshot_json: AttachmentSchemaSnapshotPayload;
}

export interface AttachmentSchemaResponse {
  id?: string;
  attachment_id?: string;
  field_id: string | null;
  section_key: string;
  field_key: string;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

export interface AttachmentSchemaSavePayload {
  responses: AttachmentSchemaResponse[];
  mark_complete?: boolean;
}
