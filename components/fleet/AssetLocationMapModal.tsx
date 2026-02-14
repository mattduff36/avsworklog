'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '@/components/ui/dialog';
import { X } from 'lucide-react';
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

interface OtherVehicle {
  vehicleId: string;
  name: string;
  vrn: string;
  lat: number;
  lng: number;
  speed: number;
  heading: number;
  updatedAt: string;
}

interface AssetLocationMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetLabel: string;
  location: LocationData | null;
}

/** Extract a short display label from a FleetSmart vehicle name */
function extractLabel(name: string, vrn: string): string {
  const slashIdx = name.lastIndexOf('/');
  if (slashIdx !== -1) {
    return name.substring(slashIdx + 1).trim();
  }
  if (vrn) return vrn;
  const dashIdx = name.lastIndexOf(' - ');
  if (dashIdx !== -1) {
    return name.substring(dashIdx + 3).trim();
  }
  return name;
}

export function AssetLocationMapModal({
  open,
  onOpenChange,
  assetLabel,
  location,
}: AssetLocationMapModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);
  const [otherVehicles, setOtherVehicles] = useState<OtherVehicle[]>([]);
  const [fetchDone, setFetchDone] = useState(false);

  // Fetch all vehicle locations when modal opens
  useEffect(() => {
    if (!open) {
      setFetchDone(false);
      setOtherVehicles([]);
      return;
    }

    let cancelled = false;

    async function fetchAll() {
      try {
        const res = await fetch('/api/fleetsmart/all-locations');
        if (!res.ok) {
          console.warn('[MapModal] all-locations fetch failed:', res.status);
          if (!cancelled) setFetchDone(true);
          return;
        }
        const data = await res.json();
        console.log('[MapModal] Fetched vehicles count:', data.count, 'array length:', data.vehicles?.length);
        if (!cancelled) {
          setOtherVehicles(data.vehicles ?? []);
          setFetchDone(true);
        }
      } catch (err) {
        console.warn('[MapModal] all-locations fetch error:', err);
        if (!cancelled) setFetchDone(true);
      }
    }

    fetchAll();
    return () => { cancelled = true; };
  }, [open]);

  // Initialize map ONLY after fetch is done (or at least attempted)
  useEffect(() => {
    if (!open || !fetchDone || !location) return;

    function initMap() {
      if (!mapContainerRef.current) return;

      // Clean up previous
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
      if (!apiKey) return;

      const rect = mapContainerRef.current.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setTimeout(initMap, 150);
        return;
      }

      maptilersdk.config.apiKey = apiKey;

      const map = new maptilersdk.Map({
        container: mapContainerRef.current,
        style: maptilersdk.MapStyle.STREETS.DARK,
        center: [location.lng, location.lat],
        zoom: 15,
        interactive: true,
      });

      // Add other vehicle markers (blue) with labels
      let otherCount = 0;
      for (const v of otherVehicles) {
        if (String(v.vehicleId) === String(location.vehicleId)) continue;
        if (isNaN(v.lat) || isNaN(v.lng)) continue;

        const label = extractLabel(v.name, v.vrn);
        otherCount++;

        new maptilersdk.Marker({ color: '#3b82f6' })
          .setLngLat([v.lng, v.lat])
          .setPopup(
            new maptilersdk.Popup({ offset: 25 }).setHTML(
              `<div style="color: #1e293b; padding: 4px; font-size: 13px;">
                <strong>${label}</strong><br/>
                ${v.vrn ? `VRN: ${v.vrn}<br/>` : ''}
                Speed: ${v.speed ?? 0} mph<br/>
                Last seen: ${new Date(v.updatedAt).toLocaleString('en-GB')}
              </div>`
            )
          )
          .addTo(map);
      }

      console.log(`[MapModal] Added ${otherCount} other vehicle markers`);

      // Add main asset marker (red) – on top
      const marker = new maptilersdk.Marker({ color: '#ef4444' })
        .setLngLat([location.lng, location.lat])
        .setPopup(
          new maptilersdk.Popup({ offset: 25 }).setHTML(
            `<div style="color: #1e293b; padding: 4px; font-size: 13px;">
              <strong>${assetLabel}</strong><br/>
              ${location.vrn ? `VRN: ${location.vrn}<br/>` : ''}
              Speed: ${location.speed ?? 0} mph<br/>
              Last seen: ${new Date(location.updatedAt).toLocaleString('en-GB')}
            </div>`
          )
        )
        .addTo(map);

      marker.togglePopup();
      mapRef.current = map;
    }

    // Delay to allow dialog animation + DOM layout
    const timer = setTimeout(initMap, 300);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [open, fetchDone, location, assetLabel, otherVehicles]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[85vh] p-0 gap-0 flex flex-col [&>button:last-of-type]:hidden">
        {/* Custom larger close button */}
        <DialogClose className="absolute right-4 top-4 z-10 h-10 w-10 flex items-center justify-center rounded-lg bg-slate-800/90 hover:bg-slate-700 border border-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-ring">
          <X className="h-5 w-5 text-slate-100" />
          <span className="sr-only">Close</span>
        </DialogClose>
        <DialogHeader className="px-6 pt-6 pb-3 flex-shrink-0 pr-16">
          <DialogTitle>Location – {assetLabel}</DialogTitle>
          <DialogDescription>
            {location
              ? `Last reported: ${new Date(location.updatedAt).toLocaleString('en-GB')} · Speed: ${location.speed ?? 0} mph`
              : 'No location data available'}
          </DialogDescription>
          <div className="flex items-center gap-4 pt-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full bg-red-500 border border-red-400" />
              Current asset
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full bg-blue-500 border border-blue-400" />
              Other vehicles / plant
            </span>
          </div>
        </DialogHeader>
        <div className="flex-1 px-6 pb-6 min-h-0">
          <div
            ref={mapContainerRef}
            className="w-full rounded-lg overflow-hidden"
            style={{ height: 'calc(85vh - 150px)', minHeight: '400px' }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
