'use client';

import { toast } from 'sonner';

export function createSafeAction(label: string): () => void {
  return () => {
    toast.info(`Safe demo mode: "${label}" action blocked.`);
  };
}

export function createSafeAsyncAction(label: string, delayMs = 800): () => Promise<void> {
  return async () => {
    toast.info(`Safe demo mode: "${label}" action simulated.`);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  };
}
