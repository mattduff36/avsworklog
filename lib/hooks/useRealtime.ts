'use client';

import { useEffect } from 'react';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type RealtimeCallback = (payload: RealtimePostgresChangesPayload<Record<string, never>>) => void;

export function useRealtimeSubscription(
  table: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
  callback: RealtimeCallback,
  filter?: string
) {
  const supabase = createClient();

  useEffect(() => {
    let channel: RealtimeChannel;

    const subscribe = () => {
      const channelBuilder = supabase.channel(`${table}_changes`);
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const channelWithListener = (channelBuilder as any).on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (payload: any) => {
          callback(payload as never);
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
  }, [table, event, filter]);
}

export function useTimesheetRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('timesheets', '*', callback);
}

export function useInspectionRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('vehicle_inspections', '*', callback);
}

