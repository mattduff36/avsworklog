'use client';

import { useEffect, useRef, useCallback } from 'react';
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

interface AssetLocationMapModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  assetLabel: string;
  location: LocationData | null;
}

export function AssetLocationMapModal({
  open,
  onOpenChange,
  assetLabel,
  location,
}: AssetLocationMapModalProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maptilersdk.Map | null>(null);

  const initMap = useCallback(() => {
    if (!location || !mapContainerRef.current) return;

    // Clean up previous map
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
    if (!apiKey) return;

    // Verify the container has dimensions
    const rect = mapContainerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      // Container not yet rendered — retry shortly
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

    // Auto-open the popup
    marker.togglePopup();

    mapRef.current = map;
  }, [location, assetLabel]);

  useEffect(() => {
    if (!open) {
      // Cleanup on close
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      return;
    }

    // Delay to allow dialog animation + DOM layout
    const timer = setTimeout(initMap, 300);

    return () => {
      clearTimeout(timer);
    };
  }, [open, initMap]);

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
        </DialogHeader>
        <div className="flex-1 px-6 pb-6 min-h-0">
          <div
            ref={mapContainerRef}
            className="w-full rounded-lg overflow-hidden"
            style={{ height: 'calc(85vh - 130px)', minHeight: '400px' }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
