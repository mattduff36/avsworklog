'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { Skeleton } from '@/components/ui/skeleton';
import { MapPin } from 'lucide-react';
import * as maptilersdk from '@maptiler/sdk';
import '@maptiler/sdk/dist/maptiler-sdk.css';

interface LocationData {
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  updatedAt: string;
  name: string;
  vrn: string;
  vehicleId: string;
}

interface AssetLocationMapProps {
  plantId?: string;
  regNumber?: string;
  assetLabel: string;
  className?: string;
  onMatchResult?: (hasMatch: boolean) => void;
  onLocationData?: (data: LocationData) => void;
  onClick?: () => void;
}

export function AssetLocationMap({
  plantId,
  regNumber,
  assetLabel,
  className = '',
  onMatchResult,
  onLocationData,
  onClick,
}: AssetLocationMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);
  const [loading, setLoading] = useState(true);
  const [locationData, setLocationData] = useState<LocationData | null>(null);
  const [hasMatch, setHasMatch] = useState<boolean | null>(null);

  const fetchLocation = useCallback(async () => {
    if (!plantId && !regNumber) {
      setHasMatch(false);
      onMatchResult?.(false);
      setLoading(false);
      return;
    }

    try {
      const params = new URLSearchParams();
      if (plantId) params.set('plantId', plantId);
      if (regNumber) params.set('regNumber', regNumber);

      const res = await fetch(`/api/fleetsmart/location?${params.toString()}`);
      const data = await res.json();

      if (data.error === 'not_found' || data.error === 'missing_credentials') {
        setHasMatch(false);
        onMatchResult?.(false);
        setLoading(false);
        return;
      }

      if (data.error === 'no_location') {
        setHasMatch(false);
        onMatchResult?.(false);
        setLoading(false);
        return;
      }

      if (data.lat && data.lng) {
        const loc: LocationData = {
          lat: data.lat,
          lng: data.lng,
          speed: data.speed,
          heading: data.heading,
          updatedAt: data.updatedAt,
          name: data.name,
          vrn: data.vrn,
          vehicleId: data.vehicleId,
        };
        setLocationData(loc);
        setHasMatch(true);
        onMatchResult?.(true);
        onLocationData?.(loc);
      } else {
        setHasMatch(false);
        onMatchResult?.(false);
      }
    } catch {
      setHasMatch(false);
      onMatchResult?.(false);
    } finally {
      setLoading(false);
    }
  }, [plantId, regNumber, onMatchResult, onLocationData]);

  useEffect(() => {
    fetchLocation();
  }, [fetchLocation]);

  // Initialise map once we have location
  useEffect(() => {
    if (!locationData || !mapContainerRef.current) return;
    if (mapRef.current) return; // already initialised

    const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
    if (!apiKey) return;

    maptilersdk.config.apiKey = apiKey;

    const map = new maptilersdk.Map({
      container: mapContainerRef.current,
      style: maptilersdk.MapStyle.STREETS.DARK,
      center: [locationData.lng, locationData.lat],
      zoom: 14,
      interactive: false, // small preview – non-interactive
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

  // Don't render anything if no match or still determining
  if (loading) {
    return (
      <div className={`rounded-lg overflow-hidden ${className}`}>
        <Skeleton className="w-full h-full min-h-[180px]" />
      </div>
    );
  }

  if (!hasMatch || !locationData) {
    return null;
  }

  return (
    <div
      className={`rounded-lg overflow-hidden cursor-pointer relative group ${className}`}
      onClick={onClick}
      title={`Click to expand map – ${assetLabel}`}
    >
      <div ref={mapContainerRef} className="w-full h-full min-h-[180px]" />
      {/* Hover overlay */}
      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center pointer-events-none">
        <div className="opacity-0 group-hover:opacity-100 transition-opacity bg-black/60 rounded-full p-2">
          <MapPin className="h-5 w-5 text-white" />
        </div>
      </div>
      {/* Status badge */}
      <div className="absolute bottom-2 left-2 bg-black/70 text-xs text-slate-300 px-2 py-1 rounded">
        Last seen: {new Date(locationData.updatedAt).toLocaleString('en-GB', {
          day: 'numeric',
          month: 'short',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </div>
    </div>
  );
}
