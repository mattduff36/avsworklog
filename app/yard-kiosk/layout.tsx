import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Yard Inventory Kiosk',
  description: 'Touch-first Yard inventory transfer kiosk.',
};

export default function YardKioskLayout({ children }: { children: ReactNode }) {
  return children;
}
