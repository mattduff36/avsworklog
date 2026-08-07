import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const modalSource = readFileSync(
  join(process.cwd(), 'app/(dashboard)/inventory/components/InventoryCheckModal.tsx'),
  'utf8',
);
const moveSource = readFileSync(
  join(process.cwd(), 'app/(dashboard)/inventory/components/MoveInventoryDialog.tsx'),
  'utf8',
);
const detailSource = readFileSync(
  join(process.cwd(), 'app/(dashboard)/inventory/items/[itemId]/page.tsx'),
  'utf8',
);
const pageSource = readFileSync(
  join(process.cwd(), 'app/(dashboard)/inventory/page.tsx'),
  'utf8',
);

describe('INV-CHECK-UI and refresh contracts', () => {
  it('INV-CHECK-UI-001 requires future confirmation and stable submission ids', () => {
    expect(modalSource).toContain('createInventoryCheckSubmissionId');
    expect(modalSource).toContain('isFutureInventoryCheckDate');
    expect(modalSource).toContain('Confirm future check date');
    expect(modalSource).toContain('confirm_future_date');
    expect(modalSource).toContain('submission_id');
  });

  it('INV-CHECK-REFRESH-001 refreshes list and detail after move-dialog checks without treating refresh as save failure', () => {
    expect(moveSource).toContain('onCheckRecorded');
    expect(moveSource).toContain('runInventoryCheckRefresh');
    expect(detailSource).toContain('runInventoryCheckRefresh');
    expect(detailSource).toContain('buildInventoryItemDetailsUpdatePayload');
    expect(pageSource).toContain('onCheckRecorded={async () => {');
    expect(pageSource).toContain('await fetchInventoryData();');
    expect(detailSource).toContain('onCheckRecorded={async () => {');
    expect(detailSource).toContain('await fetchHistory();');
    expect(detailSource).toContain('fetchHistory({ quiet: true })');
    expect(detailSource).toContain('hasCheckHistory');
    expect(detailSource).toContain('Managed by recorded inventory checks');
    expect(detailSource).not.toContain('toISOString().slice(0, 10)');
  });
});
