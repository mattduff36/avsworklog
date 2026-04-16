import { createAdminClient } from '@/lib/supabase/admin';

export interface AdminAttachmentSchemaSnapshotRow {
  attachment_id: string;
  snapshot_json: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface AdminAttachmentFieldResponseRow {
  attachment_id: string;
  section_key: string;
  field_key: string;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
  [key: string]: unknown;
}

export async function getAdminSchemaSnapshotsForAttachmentIds(
  attachmentIds: readonly string[],
): Promise<AdminAttachmentSchemaSnapshotRow[]> {
  if (attachmentIds.length === 0) {
    return [];
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workshop_attachment_schema_snapshots')
    .select('*')
    .in('attachment_id', [...attachmentIds]);

  if (error) {
    throw error;
  }

  return (data || []) as AdminAttachmentSchemaSnapshotRow[];
}

export async function getAdminSchemaSnapshotForAttachment(
  attachmentId: string,
): Promise<AdminAttachmentSchemaSnapshotRow | null> {
  const snapshots = await getAdminSchemaSnapshotsForAttachmentIds([attachmentId]);
  return snapshots[0] || null;
}

export async function getAdminFieldResponsesForAttachmentIds(
  attachmentIds: readonly string[],
): Promise<AdminAttachmentFieldResponseRow[]> {
  if (attachmentIds.length === 0) {
    return [];
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workshop_attachment_field_responses')
    .select('*')
    .in('attachment_id', [...attachmentIds]);

  if (error) {
    throw error;
  }

  return (data || []) as AdminAttachmentFieldResponseRow[];
}

export async function getAdminFieldResponsesForAttachment(
  attachmentId: string,
): Promise<AdminAttachmentFieldResponseRow[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('workshop_attachment_field_responses')
    .select('*')
    .eq('attachment_id', attachmentId);

  if (error) {
    throw error;
  }

  return (data || []) as AdminAttachmentFieldResponseRow[];
}
