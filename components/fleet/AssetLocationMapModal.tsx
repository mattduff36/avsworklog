'use client';

import { useEffect, useRef } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
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

  useEffect(() => {
    if (!open || !location || !mapContainerRef.current) return;

    // Short delay to ensure the dialog DOM is rendered
    const timer = setTimeout(() => {
      if (!mapContainerRef.current) return;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const apiKey = process.env.NEXT_PUBLIC_MAPTILER_API_KEY;
      if (!apiKey) return;

      maptilersdk.config.apiKey = apiKey;

      const map = new maptilersdk.Map({
        container: mapContainerRef.current,
        style: maptilersdk.MapStyle.STREETS.DARK,
        center: [location.lng, location.lat],
        zoom: 15,
        interactive: true,
      });

      new maptilersdk.Marker({ color: '#ef4444' })
        .setLngLat([location.lng, location.lat])
        .setPopup(
          new maptilersdk.Popup({ offset: 25 }).setHTML(
            `<div style="color: #1e293b; padding: 4px;">
              <strong>${assetLabel}</strong><br/>
              ${location.vrn ? `VRN: ${location.vrn}<br/>` : ''}
              Speed: ${location.speed ?? 0} mph<br/>
              Last seen: ${new Date(location.updatedAt).toLocaleString('en-GB')}
            </div>`
          )
        )
        .addTo(map);

      mapRef.current = map;
    }, 100);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [open, location, assetLabel]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] w-[90vw] max-h-[85vh] h-[85vh] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-3">
          <DialogTitle>Location – {assetLabel}</DialogTitle>
          <DialogDescription>
            {location
              ? `Last reported: ${new Date(location.updatedAt).toLocaleString('en-GB')} · Speed: ${location.speed ?? 0} mph`
              : 'No location data available'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex-1 min-h-0 px-6 pb-6">
          <div
            ref={mapContainerRef}
            className="w-full h-full min-h-[400px] rounded-lg overflow-hidden"
            style={{ height: 'calc(85vh - 120px)' }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
