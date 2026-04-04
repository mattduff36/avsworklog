'use client';

import { createClient } from '@/lib/supabase/client';
import { clearViewAsSelection } from '@/lib/utils/view-as-cookie';
import type { AccountSwitchStoredSession } from '@/lib/account-switch/types';
import {
  clearAccountSwitchTransition,
  markAccountSwitchTransition,
} from '@/lib/account-switch/transition';

function removeRoleCacheEntries(): void {
  if (typeof window === 'undefined') return;

  const keysToRemove: string[] = [];
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key) continue;
    if (key.startsWith('role_cache_')) {
      keysToRemove.push(key);
    }
  }

  keysToRemove.forEach((key) => localStorage.removeItem(key));
}

export function clearAccountSwitchClientState(): void {
  if (typeof window === 'undefined') return;

  clearViewAsSelection();
  removeRoleCacheEntries();
}

export async function switchActiveSession(
  session: AccountSwitchStoredSession
): Promise<{ success: boolean; errorMessage: string | null }> {
  const supabase = createClient();
  if (!supabase) {
    return { success: false, errorMessage: 'Unable to initialize session client' };
  }

  // Signal intentional identity transition to suppress false-positive auth hooks.
  markAccountSwitchTransition();
  clearAccountSwitchClientState();

  const { error } = await supabase.auth.setSession({
    access_token: session.accessToken,
    refresh_token: session.refreshToken,
  });

  if (error) {
    clearAccountSwitchTransition();
    return { success: false, errorMessage: error.message };
  }

  return { success: true, errorMessage: null };
}
