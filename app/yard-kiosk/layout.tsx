import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { YardKioskStatusBar } from './components/YardKioskStatusBar';

const YARD_KIOSK_THEME_COLOR = '#020617';
const YARD_KIOSK_MANIFEST_VERSION = '20260720-status-bar';

export const metadata: Metadata = {
  title: 'Yard Inventory Kiosk',
  description: 'Touch-first Yard inventory transfer kiosk.',
  applicationName: 'Yard Inventory',
  manifest: `/manifest-yard-kiosk.json?v=${YARD_KIOSK_MANIFEST_VERSION}`,
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
  themeColor: YARD_KIOSK_THEME_COLOR,
  colorScheme: 'dark',
};

export default function YardKioskLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <YardKioskStatusBar />
      {children}
    </>
  );
}
