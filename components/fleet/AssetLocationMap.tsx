'use client';

import { useEffect, useRef, useState } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { Expand, Loader2 } from 'lucide-react';
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';
import type { TrackerLocationData } from '@/types/fleet-tracker';

interface AssetLocationMapProps {
  plantId?: string;
  regNumber?: string;
  assetLabel: string;
  locationProvider?: 'fleetsmart' | 'velocityfleet';
  loadingVariant?: 'skeleton' | 'compact';
  className?: string;
  onMatchResult?: (hasMatch: boolean) => void;
  onLocationData?: (data: TrackerLocationData) => void;
  onClick?: () => void;
  prefetchAllLocations?: boolean;
}

function getLocationEndpoint(locationProvider: 'fleetsmart' | 'velocityfleet'): string {
  return locationProvider === 'velocityfleet'
    ? '/api/velocityfleet/location'
    : '/api/fleetsmart/location';
}

function getAllLocationsEndpoint(locationProvider: 'fleetsmart' | 'velocityfleet'): string {
  return locationProvider === 'velocityfleet'
    ? '/api/velocityfleet/all-locations'
    : '/api/fleetsmart/all-locations';
}

export function AssetLocationMap({
  plantId,
  regNumber,
  assetLabel,
  locationProvider = 'fleetsmart',
  loadingVariant = 'skeleton',
  className = '',
  onMatchResult,
  onLocationData,
  onClick,
  prefetchAllLocations = true,
}: AssetLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationData, setLocationData] = useState<TrackerLocationData | null>(null);
  const [hasMatch, setHasMatch] = useState<boolean | null>(null);

  // Stable refs for callbacks to avoid re-triggering the fetch
  const onMatchResultRef = useRef(onMatchResult);
  const onLocationDataRef = useRef(onLocationData);
  useEffect(() => { onMatchResultRef.current = onMatchResult; }, [onMatchResult]);
  useEffect(() => { onLocationDataRef.current = onLocationData; }, [onLocationData]);

  useEffect(() => {
    setLoading(true);
    setLocationData(null);
    setHasMatch(null);

    const hasLookupValue = locationProvider === 'velocityfleet'
      ? Boolean(regNumber)
      : Boolean(plantId || regNumber);

    if (!hasLookupValue) {
      setHasMatch(false);
      onMatchResultRef.current?.(false);
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;

    async function fetchLocation() {
      try {
        const params = new URLSearchParams();
        if (locationProvider === 'fleetsmart' && plantId) params.set('plantId', plantId);
        if (regNumber) params.set('regNumber', regNumber);

        const res = await fetch(`${getLocationEndpoint(locationProvider)}?${params.toString()}`, {
          signal: controller.signal,
          cache: 'no-store',
        });

        if (!res.ok) {
          if (!cancelled) {
            setHasMatch(false);
            onMatchResultRef.current?.(false);
            setLoading(false);
          }
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        if (data.error) {
          setHasMatch(false);
          onMatchResultRef.current?.(false);
          setLoading(false);
          return;
        }

        const lat = typeof data.lat === 'number' ? data.lat : parseFloat(data.lat);
        const lng = typeof data.lng === 'number' ? data.lng : parseFloat(data.lng);
        if (!isNaN(lat) && !isNaN(lng)) {
          const loc: TrackerLocationData = {
            lat,
            lng,
            speed: data.speed,
            heading: data.heading,
            updatedAt: data.updatedAt,
            name: data.name,
            vrn: data.vrn,
            vehicleId: data.vehicleId,
            nickname: data.nickname ?? null,
          };
          setLocationData(loc);
          setHasMatch(true);
          onMatchResultRef.current?.(true);
          onLocationDataRef.current?.(loc);

          if (prefetchAllLocations) {
            fetch(getAllLocationsEndpoint(locationProvider)).catch(() => {});
          }
        } else {
          setHasMatch(false);
          onMatchResultRef.current?.(false);
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) {
          return;
        }
        if (!cancelled) {
          setHasMatch(false);
          onMatchResultRef.current?.(false);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void fetchLocation();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [plantId, regNumber, locationProvider]);

  // Rebuild the map when the selected-asset location changes.
  useEffect(() => {
    if (!locationData || !mapContainerRef.current) {
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
    if (!apiKey) return;

    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    maptilersdk.config.apiKey = apiKey;

    const map = new maptilersdk.Map({
      container: mapContainerRef.current,
      style: '019c5e68-f020-7497-955c-16a05a3779b3',
      center: [locationData.lng, locationData.lat],
      zoom: 14,
      interactive: false,
      navigationControl: false,
      geolocateControl: false,
      terrainControl: false,
      scaleControl: false,
      fullscreenControl: false,
    });

    new maptilersdk.Marker({ color: '#ef4444' })
      .setLngLat([locationData.lng, locationData.lat])
      .addTo(map);

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [locationData]);

  if (loading) {
    if (loadingVariant === 'compact') {
      return (
        <div className="flex items-center gap-2 rounded-lg border border-slate-700/40 bg-slate-900/20 px-3 py-2 text-xs text-slate-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-300" />
          <span>Loading tracker location...</span>
        </div>
      );
    }

    return (
      <div className={`rounded-lg overflow-hidden ${className}`}>
        <Skeleton className="w-full h-full min-h-[265px]" />
      </div>
    );
  }

  if (!hasMatch || !locationData) {
    return null;
  }

  return (
    <div
      className={`rounded-lg overflow-hidden cursor-pointer relative group border border-slate-700/50 ${className}`}
      onClick={onClick}
      title={`Click to expand map – ${assetLabel}`}
    >
      {/* Map container – hide all SDK UI controls via CSS */}
      <div
        ref={mapContainerRef}
        className="w-full h-full min-h-[265px] [&_.maplibregl-ctrl-bottom-left]:!hidden [&_.maplibregl-ctrl-bottom-right]:!hidden [&_.maplibregl-ctrl-top-left]:!hidden [&_.maplibregl-ctrl-top-right]:!hidden"
      />
      {/* Expand hint on hover */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center pointer-events-none">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/70 rounded-full p-2.5">
          <Expand className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
}
