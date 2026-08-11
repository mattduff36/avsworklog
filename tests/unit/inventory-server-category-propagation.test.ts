import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const moveSource = readFileSync(
  resolve(process.cwd(), 'lib/server/inventory-move.ts'),
  'utf-8',
);

const kioskSource = readFileSync(
  resolve(process.cwd(), 'lib/server/inventory-kiosk.ts'),
  'utf-8',
);

const itemDetailSource = readFileSync(
  resolve(process.cwd(), 'app/(dashboard)/inventory/items/[itemId]/page.tsx'),
  'utf-8',
);

const itemDialogSource = readFileSync(
  resolve(process.cwd(), 'app/(dashboard)/inventory/components/InventoryItemDialog.tsx'),
  'utf-8',
);

describe('inventory server category propagation for check intervals', () => {
  it('selects category for move blocking checks', () => {
    expect(moveSource).toContain('category: string | null');
    expect(moveSource).toContain(
      ".select('id, item_number, name, category, last_checked_at, check_interval_days, location:inventory_locations(id, name, location_type)')",
    );
  });

  it('selects category for kiosk bootstrap and submit blocking checks', () => {
    expect(kioskSource).toContain(
      ".select('id, item_number, name, category, last_checked_at, check_interval_days')",
    );
    expect(kioskSource).toMatch(
      /getCheckWarningItems[\s\S]*\.select\('id, item_number, name, category, last_checked_at, check_interval_days'\)/,
    );
  });

  it('uses the editable category for check-interval default placeholders', () => {
    expect(itemDetailSource).toContain(
      'placeholder={`Default ${getDefaultCheckIntervalMonths(editForm.category)}`}',
    );
    expect(itemDetailSource).not.toContain(
      'placeholder={`Default ${getDefaultCheckIntervalMonths(item.category)}`}',
    );
    expect(itemDialogSource).toContain(
      'placeholder={`Default ${getDefaultCheckIntervalMonths(form.category)}`}',
    );
  });
});
