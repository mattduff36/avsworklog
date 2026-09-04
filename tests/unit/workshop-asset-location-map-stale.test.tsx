/** @vitest-environment happy-dom */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { AssetLocationMap } from '@/components/fleet/AssetLocationMap';

vi.mock('@maptiler/sdk', () => {
  class Marker {
    setLngLat() {
      return this;
    }
    addTo() {
      return this;
    }
  }
  class Map {
    remove() {}
  }
  return {
    config: { apiKey: '' },
    Map,
    Marker,
  };
});

interface DeferredLocation {
  url: string;
  signal?: AbortSignal;
  resolve: (value: { ok: boolean; json: () => Promise<unknown> }) => void;
  reject: (error: unknown) => void;
}

function createDeferredLocationFetch() {
  const pending: DeferredLocation[] = [];
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    return new Promise<{ ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
      const entry: DeferredLocation = {
        url,
        signal: init?.signal ?? undefined,
        resolve,
        reject,
      };
      pending.push(entry);
      init?.signal?.addEventListener('abort', () => {
        entry.reject(
          Object.assign(new DOMException('The operation was aborted.', 'AbortError'), {
            name: 'AbortError',
          })
        );
      });
    });
  });
  return { fetchMock, pending };
}

function resolvePlant(
  pending: DeferredLocation[],
  plantId: string,
  coords: { lat: number; lng: number }
): void {
  const entry = pending.find((item) => item.url.includes(`plantId=${plantId}`));
  if (!entry) throw new Error(`missing deferred location fetch for ${plantId}`);
  entry.resolve({
    ok: true,
    json: async () => ({
      lat: coords.lat,
      lng: coords.lng,
      name: plantId,
      vrn: plantId,
      updatedAt: '2026-09-04T12:00:00.000Z',
    }),
  });
}

describe('AssetLocationMap selected-asset fetch lifecycle', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('WT-WHERE-TRACKER-STALE aborts asset A and never lets it populate asset B', async () => {
    const { fetchMock, pending } = createDeferredLocationFetch();
    vi.stubGlobal('fetch', fetchMock);

    const onLocationData = vi.fn();
    const onMatchResult = vi.fn();
    const { rerender, unmount } = render(
      <AssetLocationMap
        plantId="plant-a"
        assetLabel="Plant A"
        prefetchAllLocations={false}
        loadingVariant="compact"
        onLocationData={onLocationData}
        onMatchResult={onMatchResult}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('plantId=plant-a');
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('all-locations');

    rerender(
      <AssetLocationMap
        plantId="plant-b"
        assetLabel="Plant B"
        prefetchAllLocations={false}
        loadingVariant="compact"
        onLocationData={onLocationData}
        onMatchResult={onMatchResult}
      />
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const requestA = pending.find((item) => item.url.includes('plantId=plant-a'));
    const requestB = pending.find((item) => item.url.includes('plantId=plant-b'));
    expect(requestA?.signal?.aborted).toBe(true);
    expect(requestB?.signal?.aborted).toBe(false);

    resolvePlant(pending, 'plant-a', { lat: 51.1, lng: -1.1 });
    await Promise.resolve();
    expect(onLocationData).not.toHaveBeenCalled();
    expect(onMatchResult).not.toHaveBeenCalledWith(true);

    resolvePlant(pending, 'plant-b', { lat: 52.2, lng: -2.2 });
    await waitFor(() => expect(onLocationData).toHaveBeenCalledTimes(1));
    expect(onLocationData).toHaveBeenCalledWith(
      expect.objectContaining({ lat: 52.2, lng: -2.2, name: 'plant-b' })
    );
    expect(onMatchResult).toHaveBeenCalledWith(true);
    expect(fetchMock.mock.calls.every((call) => !String(call[0]).includes('all-locations'))).toBe(
      true
    );

    unmount();
    expect(requestB?.signal?.aborted).toBe(true);

    const second = createDeferredLocationFetch();
    vi.stubGlobal('fetch', second.fetchMock);
    const leakedLocation = vi.fn();
    const leakedMatch = vi.fn();
    const secondRender = render(
      <AssetLocationMap
        plantId="plant-c"
        assetLabel="Plant C"
        prefetchAllLocations={false}
        loadingVariant="compact"
        onLocationData={leakedLocation}
        onMatchResult={leakedMatch}
      />
    );

    await waitFor(() => expect(second.fetchMock).toHaveBeenCalledTimes(1));
    secondRender.unmount();
    const requestC = second.pending.find((item) => item.url.includes('plantId=plant-c'));
    expect(requestC?.signal?.aborted).toBe(true);
    resolvePlant(second.pending, 'plant-c', { lat: 53.3, lng: -3.3 });
    await Promise.resolve();
    expect(leakedLocation).not.toHaveBeenCalled();
    expect(leakedMatch).not.toHaveBeenCalledWith(true);
  });
});
