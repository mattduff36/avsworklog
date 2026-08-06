import { describe, expect, it } from 'vitest';
import {
  buildQuoteSiteLocationName,
  decideRepairQuoteSiteLocation,
  getQuoteSiteLocationLabel,
  isQuoteEligibleForActiveSiteLocation,
  normalizeRepairExternalReference,
  parseRepairQuoteSiteCliArgs,
  type RepairQuoteRow,
  type RepairSiteLocationRow,
} from '@/lib/server/repair-quote-site-location';

function makeQuote(overrides: Partial<RepairQuoteRow> = {}): RepairQuoteRow {
  return {
    id: 'quote-1',
    quote_reference: '40106-GH',
    base_quote_reference: '40106-GH',
    status: 'sent',
    commercial_status: 'open',
    site_address: 'Unit 1\nIndustrial Estate',
    subject_line: 'Fence works',
    is_latest_version: true,
    revision_number: 0,
    created_at: '2026-07-28T09:04:11.272Z',
    created_by: 'user-1',
    updated_by: 'user-1',
    ...overrides,
  };
}

function makeLocation(overrides: Partial<RepairSiteLocationRow> = {}): RepairSiteLocationRow {
  return {
    id: 'loc-1',
    name: 'Site - 40106-GH - Unit 1',
    description: 'Unit 1',
    is_active: true,
    location_type: 'site',
    source_type: 'quote',
    source_id: 'quote-1',
    external_reference: '40106-GH',
    sync_status: 'synced',
    ...overrides,
  };
}

describe('repair quote site location helpers (QSL-000)', () => {
  it('parses CLI args with dry-run default', () => {
    expect(parseRepairQuoteSiteCliArgs(['--quote-reference', '40106-GH'])).toEqual({
      quoteReference: '40106-GH',
      apply: false,
      help: false,
    });
    expect(parseRepairQuoteSiteCliArgs(['--quote-reference=40106-gh', '--apply'])).toEqual({
      quoteReference: '40106-gh',
      apply: true,
      help: false,
    });
  });

  it('normalizes references and builds display names', () => {
    expect(normalizeRepairExternalReference(' 40106-gh ')).toBe('40106-GH');
    expect(getQuoteSiteLocationLabel(makeQuote())).toBe('Unit 1');
    expect(buildQuoteSiteLocationName('40106-GH', 'Unit 1')).toBe('Site - 40106-GH - Unit 1');
  });

  it('treats draft and sent open quotes as eligible', () => {
    expect(isQuoteEligibleForActiveSiteLocation({ status: 'draft', commercial_status: 'open' })).toBe(true);
    expect(isQuoteEligibleForActiveSiteLocation({ status: 'sent', commercial_status: 'open' })).toBe(true);
    expect(isQuoteEligibleForActiveSiteLocation({ status: 'lost', commercial_status: 'open' })).toBe(false);
    expect(isQuoteEligibleForActiveSiteLocation({ status: 'sent', commercial_status: 'closed' })).toBe(false);
  });

  it('decides create when no site exists', () => {
    const decision = decideRepairQuoteSiteLocation({
      quote: makeQuote(),
      reference: '40106-GH',
      locations: [],
      isRetiredMergeAlias: false,
    });
    expect(decision).toEqual({
      action: 'create',
      safe: true,
      reason: 'No site exists for 40106-GH; will create an active quote-owned site.',
    });
  });

  it('decides unchanged when an active quote site already exists', () => {
    const decision = decideRepairQuoteSiteLocation({
      quote: makeQuote(),
      reference: '40106-GH',
      locations: [makeLocation()],
      isRetiredMergeAlias: false,
    });
    expect(decision).toMatchObject({
      action: 'unchanged',
      safe: true,
      locationId: 'loc-1',
    });
  });

  it('reactivates a single archived quote-owned candidate', () => {
    const decision = decideRepairQuoteSiteLocation({
      quote: makeQuote(),
      reference: '40106-GH',
      locations: [makeLocation({ is_active: false, sync_status: 'archived' })],
      isRetiredMergeAlias: false,
    });
    expect(decision).toEqual({
      action: 'reactivate',
      safe: true,
      reason: 'Safe archived quote site exists for 40106-GH; will reactivate.',
      locationId: 'loc-1',
    });
  });

  it('blocks foreign ownership collisions', () => {
    const decision = decideRepairQuoteSiteLocation({
      quote: makeQuote(),
      reference: '40106-GH',
      locations: [makeLocation({ source_type: 'manual', source_id: null })],
      isRetiredMergeAlias: false,
    });
    expect(decision.safe).toBe(false);
    expect(decision.action).toBe('blocked');
  });

  it('blocks active quote sites with unexpected source_id', () => {
    const decision = decideRepairQuoteSiteLocation({
      quote: makeQuote(),
      reference: '40106-GH',
      locations: [makeLocation({ source_id: 'other-quote' })],
      isRetiredMergeAlias: false,
    });
    expect(decision).toMatchObject({ action: 'blocked', safe: false });
  });

  it('blocks claiming archived null-source rows', () => {
    const decision = decideRepairQuoteSiteLocation({
      quote: makeQuote(),
      reference: '40106-GH',
      locations: [makeLocation({ is_active: false, source_type: null, source_id: null })],
      isRetiredMergeAlias: false,
    });
    expect(decision).toMatchObject({ action: 'blocked', safe: false });
  });

  it('blocks retired merge aliases', () => {
    const decision = decideRepairQuoteSiteLocation({
      quote: makeQuote(),
      reference: '40106-GH',
      locations: [],
      isRetiredMergeAlias: true,
    });
    expect(decision).toMatchObject({ action: 'blocked', safe: false });
  });
});
