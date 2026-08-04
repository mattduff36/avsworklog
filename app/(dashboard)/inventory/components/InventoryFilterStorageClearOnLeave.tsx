'use client';

import { useEffect } from 'react';
import { clearAllInventoryTableFilters } from '@/lib/utils/inventory-table-filters-storage';

/** Deferred so React Strict Mode remounts do not wipe filters mid-session. */
let pendingClearTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Clears inventory table filter sessionStorage when the /inventory layout unmounts
 * (user navigates to another module). Stays mounted across list ↔ item details.
 */
export function InventoryFilterStorageClearOnLeave() {
  useEffect(() => {
    if (pendingClearTimeoutId) {
      clearTimeout(pendingClearTimeoutId);
      pendingClearTimeoutId = null;
    }

    return () => {
      pendingClearTimeoutId = setTimeout(() => {
        clearAllInventoryTableFilters();
        pendingClearTimeoutId = null;
      }, 100);
    };
  }, []);

  return null;
}
