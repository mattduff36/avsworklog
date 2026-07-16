import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Yard Inventory Kiosk',
  description: 'Touch-first Yard inventory transfer kiosk.',
  applicationName: 'Yard Inventory',
  manifest: '/manifest-yard-kiosk.json',
  appleWebApp: {
    capable: true,
    title: 'Yard Inventory',
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover',
  themeColor: '#020617',
};

export default function YardKioskLayout({ children }: { children: ReactNode }) {
  return children;
}
