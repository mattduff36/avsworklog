import { describe, expect, it } from 'vitest';
import {
  parseExternalDocumentListQuery,
  parseExternalDocumentMetadata,
  parseExternalDocumentPatch,
} from '@/lib/external-documents/validation';

const validMetadata = {
  title: 'Brake inspection',
  category: 'Inspection report',
  external_company: 'Sample Inspections Ltd',
  document_date: '2026-04-02',
  expiry_date: '2027-04-02',
  reference: 'SAMPLE-REF',
  notes: 'Sample note',
  van_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
  plant_id: null,
  hgv_id: null,
  shared_with: ['11111111-1111-4111-8111-111111111111'],
  source_files: ['inspection.pdf'],
};

describe('parseExternalDocumentMetadata', () => {
  it('accepts a complete metadata payload', () => {
    expect(parseExternalDocumentMetadata(validMetadata).title).toBe('Brake inspection');
  });

  it('rejects bad ids, impossible dates, and unexpected fields', () => {
    expect(() => parseExternalDocumentMetadata({ ...validMetadata, van_id: 'van-1' })).toThrow(/valid id/i);
    expect(() => parseExternalDocumentMetadata({ ...validMetadata, shared_with: ['not-a-person'] })).toThrow(/valid id/i);
    expect(() => parseExternalDocumentMetadata({ ...validMetadata, document_date: '2026-02-31' })).toThrow(/date/i);
    expect(() => parseExternalDocumentMetadata({ ...validMetadata, expiry_date: '02/04/2026' })).toThrow(/date/i);
    expect(() => parseExternalDocumentMetadata({ ...validMetadata, expiry_date: '2026-01-01' })).toThrow(/expiry date cannot be earlier/i);
    expect(() => parseExternalDocumentMetadata({
      ...validMetadata,
      plant_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    })).toThrow(/only one van, plant item, or HGV/i);
    expect(() => parseExternalDocumentMetadata({ ...validMetadata, storage_path: 'secret.pdf' })).toThrow(/unrecognized key/i);
  });
});

describe('parseExternalDocumentPatch', () => {
  it('rejects an empty patch, a bad id, and an unexpected field', () => {
    expect(() => parseExternalDocumentPatch({})).toThrow(/no changes were provided/i);
    expect(() => parseExternalDocumentPatch({ hgv_id: 'hgv' })).toThrow(/valid id/i);
    expect(() => parseExternalDocumentPatch({ document_date: '2026-13-01' })).toThrow(/date/i);
    expect(() => parseExternalDocumentPatch({ title: 'Updated', is_deleted: true })).toThrow(/unrecognized key/i);
  });
});

describe('parseExternalDocumentListQuery', () => {
  it('requires an asset id and type together and rejects a bad id', () => {
    expect(() => parseExternalDocumentListQuery({
      q: null,
      category: null,
      asset_type: 'van',
      asset_id: null,
      archive: 'active',
      page: 1,
      page_size: 25,
    })).toThrow(/both an asset type and an asset/i);
    expect(() => parseExternalDocumentListQuery({
      asset_type: 'plant',
      asset_id: 'plant-1',
    })).toThrow(/valid id/i);
  });
});
