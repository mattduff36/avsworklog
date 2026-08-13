import type { JobCatalogueBlockReason, JobCatalogueRecord } from '@/types/job-catalogue';

export function isReliableSiteAddress(value: string | null | undefined): boolean {
  const trimmed = (value || '').replace(/\s+/g, ' ').trim();
  if (trimmed.length < 8) return false;

  const lines = (value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) return true;

  return trimmed.split(/\s+/).filter(Boolean).length >= 3;
}

export function normalizeHiredPlantSerial(value: string | null | undefined): string {
  return (value || '').replace(/\s+/g, ' ').trim().toUpperCase();
}

export function getJobCatalogueBlockReason(
  record: Pick<JobCatalogueRecord, 'is_active' | 'address_valid'> | null,
  colliding = false
): JobCatalogueBlockReason | null {
  if (colliding) return 'ambiguous_sources';
  if (!record) return 'not_found';
  if (!record.is_active) return 'inactive_source';
  if (!record.address_valid) return 'missing_site_address';
  return null;
}

export function getJobCatalogueBlockMessage(reason: JobCatalogueBlockReason | null): string | null {
  switch (reason) {
    case 'not_found':
      return 'That job code is not in the quotation, project-number, or legacy catalogue.';
    case 'ambiguous_sources':
      return 'That job code matches more than one unrelated source. Update the source records before allocating it.';
    case 'missing_site_address':
      return 'This job code is searchable, but it cannot be allocated until its source record has a proper site address.';
    case 'inactive_source':
      return 'This job code belongs to an inactive or closed source and cannot be allocated.';
    default:
      return null;
  }
}

export function canAllocateJobCatalogueRecord(record: JobCatalogueRecord | null): boolean {
  return Boolean(record && record.is_active && record.address_valid && !record.block_reason);
}
