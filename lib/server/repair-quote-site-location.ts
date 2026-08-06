export interface RepairQuoteSiteCliOptions {
  quoteReference: string | null;
  apply: boolean;
  help: boolean;
}

export interface RepairQuoteRow {
  id: string;
  quote_reference: string;
  base_quote_reference: string | null;
  status: string;
  commercial_status: string;
  site_address: string | null;
  subject_line: string | null;
  is_latest_version: boolean;
  revision_number: number;
  created_at: string;
  created_by: string | null;
  updated_by: string | null;
}

export interface RepairSiteLocationRow {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  location_type: string;
  source_type: string | null;
  source_id: string | null;
  external_reference: string | null;
  sync_status: string;
}

export type RepairQuoteSiteDecision =
  | { action: 'create'; safe: true; reason: string }
  | { action: 'reactivate'; safe: true; reason: string; locationId: string }
  | { action: 'unchanged'; safe: true; reason: string; locationId: string }
  | { action: 'blocked'; safe: false; reason: string };

export function parseRepairQuoteSiteCliArgs(argv: string[]): RepairQuoteSiteCliOptions {
  let quoteReference: string | null = null;
  let apply = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      apply = true;
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    if (arg === '--quote-reference' || arg === '--reference') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error('Missing value for --quote-reference.');
      }
      quoteReference = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--quote-reference=')) {
      quoteReference = arg.slice('--quote-reference='.length);
      continue;
    }
    if (arg.startsWith('--reference=')) {
      quoteReference = arg.slice('--reference='.length);
      continue;
    }
    throw new Error(`Unsupported argument: ${arg}`);
  }

  return {
    quoteReference: quoteReference?.trim() || null,
    apply,
    help,
  };
}

export function normalizeRepairExternalReference(reference: string | null | undefined): string | null {
  const trimmed = reference?.trim().toUpperCase();
  return trimmed || null;
}

export function getQuoteSiteLocationLabel(
  quote: Pick<RepairQuoteRow, 'site_address' | 'subject_line'>
): string | null {
  const addressLabel = quote.site_address
    ?.split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (addressLabel) return addressLabel;
  const subject = quote.subject_line?.trim();
  return subject || null;
}

export function buildQuoteSiteLocationName(reference: string, label: string | null): string {
  return label?.trim() ? `Site - ${reference} - ${label.trim()}` : `Site - ${reference}`;
}

export function needsQuoteSiteMetadataSync(input: {
  location: RepairSiteLocationRow;
  quote: RepairQuoteRow;
  reference: string;
  name: string;
  description: string | null;
}): boolean {
  const { location, quote, reference, name, description } = input;
  return (
    location.name !== name
    || (location.description || null) !== (description || null)
    || location.is_active !== true
    || location.location_type !== 'site'
    || location.source_type !== 'quote'
    || location.source_id !== quote.id
    || normalizeRepairExternalReference(location.external_reference) !== reference
    || location.sync_status !== 'synced'
  );
}

export function isQuoteEligibleForActiveSiteLocation(
  quote: Pick<RepairQuoteRow, 'status' | 'commercial_status'>
): boolean {
  if (quote.commercial_status === 'closed') return false;
  if (quote.status === 'lost' || quote.status === 'closed') return false;
  return true;
}

export function decideRepairQuoteSiteLocation(input: {
  quote: RepairQuoteRow | null;
  reference: string;
  locations: RepairSiteLocationRow[];
  isRetiredMergeAlias: boolean;
}): RepairQuoteSiteDecision {
  const { quote, reference, locations, isRetiredMergeAlias } = input;

  if (!quote) {
    return { action: 'blocked', safe: false, reason: `No quote found for reference ${reference}.` };
  }

  if (isRetiredMergeAlias) {
    return {
      action: 'blocked',
      safe: false,
      reason: `Reference ${reference} is a retired live-merge alias and cannot receive an active site.`,
    };
  }

  if (!isQuoteEligibleForActiveSiteLocation(quote)) {
    return {
      action: 'blocked',
      safe: false,
      reason: `Quote ${reference} is not eligible (status=${quote.status}, commercial_status=${quote.commercial_status}).`,
    };
  }

  const activeLocations = locations.filter((location) => location.is_active);
  if (activeLocations.length > 1) {
    return {
      action: 'blocked',
      safe: false,
      reason: `Multiple active site locations already exist for ${reference}.`,
    };
  }

  const active = activeLocations[0] || null;
  if (active) {
    const sameReference = normalizeRepairExternalReference(active.external_reference) === reference;
    const quoteOwnedSource =
      active.location_type === 'site'
      && (active.source_type === 'quote' || active.source_type === 'legacy_quote')
      && sameReference;

    if (!quoteOwnedSource) {
      return {
        action: 'blocked',
        safe: false,
        reason: `Active site for ${reference} is owned by source_type=${active.source_type || 'null'}; refusing to overwrite.`,
      };
    }

    if (active.source_id && active.source_id !== quote.id) {
      return {
        action: 'blocked',
        safe: false,
        reason: `Active quote-owned site for ${reference} points at an unexpected source_id.`,
      };
    }

    return {
      action: 'unchanged',
      safe: true,
      reason: `Active quote site already exists for ${reference}.`,
      locationId: active.id,
    };
  }

  const archivedCandidates = locations.filter((location) =>
    !location.is_active
    && location.location_type === 'site'
    && (location.source_type === 'quote' || location.source_type === 'legacy_quote')
    && (!location.source_id || location.source_id === quote.id)
    && normalizeRepairExternalReference(location.external_reference) === reference
  );

  if (archivedCandidates.length > 1) {
    return {
      action: 'blocked',
      safe: false,
      reason: `Multiple archived site candidates exist for ${reference}; ownership is ambiguous.`,
    };
  }

  if (archivedCandidates.length === 1) {
    return {
      action: 'reactivate',
      safe: true,
      reason: `Safe archived quote site exists for ${reference}; will reactivate.`,
      locationId: archivedCandidates[0].id,
    };
  }

  const unsafeInactive = locations.filter((location) =>
    !location.is_active
    && normalizeRepairExternalReference(location.external_reference) === reference
    && !archivedCandidates.some((candidate) => candidate.id === location.id)
  );
  if (unsafeInactive.length > 0) {
    return {
      action: 'blocked',
      safe: false,
      reason: `Inactive site(s) already use reference ${reference} with non-claimable ownership; refusing to create a second identity.`,
    };
  }

  return {
    action: 'create',
    safe: true,
    reason: `No site exists for ${reference}; will create an active quote-owned site.`,
  };
}
