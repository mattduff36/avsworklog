import { describe, expect, it } from 'vitest';
import {
  buildYardKioskRecoverPath,
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
  });

  it('builds user errors with diagnostic ids and no tech jargon titles', () => {
    const error = buildYardKioskUserError('DEVICE_REVOKED');
    expect(error.diagnosticId.startsWith('YK-')).toBe(true);
    expect(error.title.toLowerCase()).not.toContain('jwt');
    expect(error.title.toLowerCase()).not.toContain('cookie');
    expect(error.whatToDoNext.toLowerCase()).toContain('pair');
  });

  it('offers Try again before re-pairing for DEVICE_REVOKED', () => {
    const error = buildYardKioskUserError('DEVICE_REVOKED');
    expect(error.actions[0]).toBe('retry');
    expect(error.actions).toContain('return_to_pairing');
    expect(error.actions).toContain('contact_manager');
    expect(error.retryable).toBe(true);
  });

  it('preserves server diagnostic ids in recovery paths', () => {
    expect(buildYardKioskRecoverPath('DEVICE_REVOKED', 'YK-ABC-1234')).toBe(
      '/yard-kiosk/recover?code=DEVICE_REVOKED&ref=YK-ABC-1234',
    );
    expect(buildYardKioskRecoverPath('SESSION_EXPIRED')).toBe(
      '/yard-kiosk/recover?code=SESSION_EXPIRED',
    );
  });
});
