'use client';

import { useEffect, useMemo } from 'react';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type RealtimeCallback<T extends Record<string, any> = Record<string, any>> = (payload: RealtimePostgresChangesPayload<T>) => void;

export function useRealtimeSubscription(
  table: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
  callback: RealtimeCallback,
  filter?: string
) {
  const supabase = useMemo(() => createClient(), []);

  useEffect(() => {
    let channel: RealtimeChannel;

    const subscribe = () => {
      const channelBuilder = supabase.channel(`${table}_changes`);
      
      // Type assertion needed due to Supabase Realtime API limitations
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channelWithListener = (channelBuilder as any).on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          callback(payload);
        }
      );
      
      channel = channelWithListener.subscribe();
    };

    subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [table, event, filter, callback, supabase]);
}

export function useTimesheetRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('timesheets', '*', callback);
}

export function useInspectionRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('van_inspections', '*', callback);
}

