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
  themeColor: '#fcd34d',
};

export default function YardKioskLayout({ children }: { children: ReactNode }) {
  return children;
}
