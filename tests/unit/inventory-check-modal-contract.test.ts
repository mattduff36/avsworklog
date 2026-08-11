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
const warningSource = readFileSync(
  join(
    process.cwd(),
    'app/(dashboard)/inventory/components/InventoryMoveCheckWarningDialog.tsx',
  ),
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

  it('INV-UI-05 confirms warning moves with a frozen payload on list and detail surfaces', () => {
    expect(moveSource).toContain('pendingMove');
    expect(moveSource).toContain('getInventoryMoveCheckWarningPayload');
    expect(moveSource).toContain('check_warning_confirmation');
    expect(warningSource).toContain('Are you sure you want to move it anyway?');
    expect(warningSource).toContain('Move anyway');
    expect(detailSource).toContain('pendingDetailsUpdate');
    expect(detailSource).toContain('detailsWarningPayload');
    expect(detailSource).toContain('check_warning_confirmation');
    expect(pageSource).toContain('check_warning_confirmation');
  });

  it('INV-CHECK-REFRESH-001 retains ordinary check-history refresh behavior', () => {
    expect(detailSource).toContain('runInventoryCheckRefresh');
    expect(detailSource).toContain('buildInventoryItemDetailsUpdatePayload');
    expect(detailSource).toContain('fetchHistory({ quiet: true })');
    expect(detailSource).toContain('hasCheckHistory');
    expect(detailSource).toContain('Managed by recorded inventory checks');
    expect(detailSource).not.toContain('toISOString().slice(0, 10)');
  });
});
