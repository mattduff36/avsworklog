export type JobCatalogueSourceType = 'live_quote' | 'legacy_quote' | 'project_number';

export type JobCatalogueBlockReason =
  | 'not_found'
  | 'ambiguous_sources'
  | 'missing_site_address'
  | 'inactive_source';

export interface JobCatalogueIdentity {
  source_type: JobCatalogueSourceType;
  source_id: string;
  job_code: string;
}

export interface JobCatalogueRecord extends JobCatalogueIdentity {
  customer_name: string | null;
  title: string | null;
  site_address: string | null;
  address_valid: boolean;
  aliases: string[];
  is_active: boolean;
  block_reason: JobCatalogueBlockReason | null;
}

export interface JobCatalogueOption {
  value: string;
  label: string;
  customerName: string | null;
  quoteTitle: string | null;
  source: JobCatalogueSourceType;
  sourceId: string;
  siteAddress: string | null;
  addressValid: boolean;
  aliases: string[];
  isAmbiguous: boolean;
  blockReason: JobCatalogueBlockReason | null;
}

export interface JobCatalogueResolveResult {
  ok: boolean;
  record: JobCatalogueRecord | null;
  block_reason: JobCatalogueBlockReason | null;
  message: string | null;
}
