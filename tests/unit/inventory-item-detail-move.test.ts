import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const detailPagePath = join(
  process.cwd(),
  'app/(dashboard)/inventory/items/[itemId]/page.tsx',
);

describe('INV-MOVE-01 inventory item detail Move action', () => {
  const source = readFileSync(detailPagePath, 'utf8');

  it('wires Move for loaded items without a retired-only gate', () => {
    expect(source).toContain("import { InventoryMoveButton } from '../../components/InventoryMoveButton'");
    expect(source).toContain("import { MoveInventoryDialog } from '../../components/MoveInventoryDialog'");
    expect(source).toContain('<InventoryMoveButton onMove={() => setMoveDialogOpen(true)} />');
    expect(source).toContain('<MoveInventoryDialog');
    expect(source).toContain("fetch('/api/inventory/move'");

    const moveButtonIndex = source.indexOf('<InventoryMoveButton onMove={() => setMoveDialogOpen(true)} />');
    expect(moveButtonIndex).toBeGreaterThan(-1);
    const preceding = source.slice(Math.max(0, moveButtonIndex - 180), moveButtonIndex);
    expect(preceding).not.toMatch(/isRetired/);
    expect(preceding).not.toMatch(/status === 'retired'/);
  });
});
