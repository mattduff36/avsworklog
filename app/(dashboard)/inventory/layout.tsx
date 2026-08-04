import type { ReactNode } from 'react';
import { InventoryFilterStorageClearOnLeave } from './components/InventoryFilterStorageClearOnLeave';

export default function InventoryLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <InventoryFilterStorageClearOnLeave />
      {children}
    </>
  );
}
