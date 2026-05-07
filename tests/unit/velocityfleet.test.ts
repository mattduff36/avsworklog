import { describe, expect, it } from 'vitest';
import {
  findVelocityfleetLocationByRegistration,
  normalizeVelocityfleetRegistration,
  parseVelocityfleetCustomerIds,
  parseVelocityfleetPositions,
  resolveVelocityfleetBaseUrl,
} from '@/lib/services/velocityfleet';

describe('Velocityfleet service helpers', () => {
  it('normalizes vehicle registrations for matching', () => {
    expect(normalizeVelocityfleetRegistration(' ab12 cde ')).toBe('AB12CDE');
    expect(normalizeVelocityfleetRegistration(null)).toBe('');
  });

  it('falls back to the documented base URL when env value is blank or invalid', () => {
    expect(resolveVelocityfleetBaseUrl('')).toBe('https://www.velocityfleet.com');
    expect(resolveVelocityfleetBaseUrl('xxxx')).toBe('https://www.velocityfleet.com');
    expect(resolveVelocityfleetBaseUrl('https://example.com/path')).toBe('https://example.com');
  });

  it('parses customer ids from Velocityfleet keyed customer responses', () => {
    expect(
      parseVelocityfleetCustomerIds({
        '2204736670001': { name: 'Customer A', number: 'A001', product: 'telematics' },
        '23716537500001': { name: 'Customer B', number: 'B001', product: 'telematics' },
      })
    ).toEqual(['2204736670001', '23716537500001']);
  });

  it('parses live device positions into map-compatible locations', () => {
    const locations = parseVelocityfleetPositions(
      {
        devices: [
          {
            id: 123,
            lat: 52.1,
            lon: -1.2,
            vehicle_registration: 'AB12 CDE',
            speed: 31,
            direction: 180,
            timestamp: '2026-05-07T18:35:00Z',
          },
          {
            id: 456,
            lat: null,
            lon: -1.3,
            vehicle_registration: 'INVALID',
          },
        ],
      },
      'customer-1'
    );

    expect(locations).toEqual([
      {
        vehicleId: '123',
        name: 'AB12 CDE',
        vrn: 'AB12 CDE',
        lat: 52.1,
        lng: -1.2,
        speed: 31,
        heading: 180,
        updatedAt: '2026-05-07T18:35:00Z',
        customerId: 'customer-1',
      },
    ]);
  });

  it('matches locations by normalized registration', () => {
    const [location] = parseVelocityfleetPositions({
      devices: [
        {
          id: 123,
          lat: '52.1',
          lon: '-1.2',
          vehicle_registration: 'AB12 CDE',
          speed: '0',
          direction: '90',
          time: '2026-05-07T18:35:00Z',
        },
      ],
    });

    expect(findVelocityfleetLocationByRegistration([location], 'ab12cde')).toBe(location);
    expect(findVelocityfleetLocationByRegistration([location], 'zz99 zzz')).toBeNull();
  });
});
