import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(
    process.cwd(),
    'supabase/migrations/20260727132410_harden_quote_purchase_orders.sql'
  ),
  'utf-8'
);

describe('quote purchase-order hardening migration', () => {
  it('protects thread-scoped POs from quote deletion', () => {
    expect(migration).toContain('quote_purchase_orders_quote_id_fkey');
    expect(migration).toMatch(
      /FOREIGN KEY \(quote_id\)[\s\S]*REFERENCES public\.quotes\(id\)[\s\S]*ON DELETE RESTRICT/
    );
  });

  it('removes orphanable line links and cascades line deletion', () => {
    expect(migration).toContain('DELETE FROM public.quote_purchase_order_lines');
    expect(migration).toContain('ALTER COLUMN quote_line_item_id SET NOT NULL');
    expect(migration).toMatch(
      /FOREIGN KEY \(quote_line_item_id\)[\s\S]*REFERENCES public\.quote_line_items\(id\)[\s\S]*ON DELETE CASCADE/
    );
  });

  it('repairs missing historical backfills without duplicating threads', () => {
    expect(migration).toContain('WITH preferred_sources AS');
    expect(migration).toContain('q.po_number IS NOT NULL OR q.po_value IS NOT NULL');
    expect(migration).toContain('WHERE NOT EXISTS');
    expect(migration).toContain('existing.quote_thread_id = source.quote_thread_id');
  });

  it('enforces thread existence and preserves unknown PO totals', () => {
    expect(migration).toContain('validate_quote_purchase_order_thread');
    expect(migration).toContain("USING ERRCODE = 'foreign_key_violation'");
    expect(migration).toContain('SELECT SUM(value_po.po_value)');
    expect(migration).not.toContain('SUM(COALESCE(value_po.po_value, 0))');
  });
});
