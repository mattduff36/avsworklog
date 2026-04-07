'use client';

import { useSyncExternalStore } from 'react';
import {
  getClientServiceOutage,
  subscribeToClientServiceOutage,
} from '@/lib/app-auth/client-service-health';

export function useClientServiceOutage() {
  return useSyncExternalStore(
    subscribeToClientServiceOutage,
    getClientServiceOutage,
    () => null
  );
}
