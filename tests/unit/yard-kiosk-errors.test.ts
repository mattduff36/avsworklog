import { describe, expect, it } from 'vitest';
import {
  buildYardKioskUserError,
  listYardKioskErrorCatalogue,
  mapPairingStatusToYardKioskErrorCode,
  mapHttpStatusToYardKioskErrorCode,
} from '@/lib/inventory/kiosk-errors';

describe('Yard kiosk error catalogue', () => {
  it('exposes plain-English recovery copy for every code', () => {
    const catalogue = listYardKioskErrorCatalogue();
    expect(catalogue.length).toBeGreaterThan(10);
    for (const entry of catalogue) {
      expect(entry.title.length).toBeGreaterThan(3);
      expect(entry.whatHappened.length).toBeGreaterThan(10);
      expect(entry.whatToDoNext.length).toBeGreaterThan(10);
      expect(entry.actions.length).toBeGreaterThan(0);
    }
  });

  it('maps pairing and HTTP statuses to stable codes', () => {
    expect(mapPairingStatusToYardKioskErrorCode('expired')).toBe('PAIRING_EXPIRED');
    expect(
      mapPairingStatusToYardKioskErrorCode(
        'unavailable',
        'Another browser is already using this pairing window.',
      ),
    ).toBe('PAIRING_CLAIMED');
    expect(mapHttpStatusToYardKioskErrorCode(401)).toBe('SESSION_EXPIRED');
    expect(mapHttpStatusToYardKioskErrorCode(409)).toBe('STOCK_STALE');
    expect(
      mapHttpStatusToYardKioskErrorCode(400, 'INVENTORY_CHECK_REQUIRED'),
    ).toBe('INVENTORY_CHECK_REQUIRED');
  });

  it('builds user errors with diagnostic ids and no tech jargon titles', () => {
    const error = buildYardKioskUserError('DEVICE_REVOKED');
    expect(error.diagnosticId.startsWith('YK-')).toBe(true);
    expect(error.title.toLowerCase()).not.toContain('jwt');
    expect(error.title.toLowerCase()).not.toContain('cookie');
    expect(error.whatToDoNext.toLowerCase()).toContain('pair');
  });
});
