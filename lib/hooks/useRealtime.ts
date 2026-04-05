'use client';

import { useEffect, useRef } from 'react';
import { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type RealtimeCallback<T extends Record<string, unknown> = Record<string, unknown>> = (payload: RealtimePostgresChangesPayload<T>) => void;

export function useRealtimeSubscription(
  table: string,
  event: 'INSERT' | 'UPDATE' | 'DELETE' | '*',
  callback: RealtimeCallback,
  filter?: string
) {
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (typeof window !== 'undefined' && !supabaseRef.current) {
    supabaseRef.current = createClient();
  }
  const supabase = supabaseRef.current;
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!supabase) return;

    let channel: RealtimeChannel;

    const subscribe = () => {
      const channelBuilder = supabase.channel(`${table}_changes`);
      
      // Type assertion: Supabase RealtimeChannelBuilder has .on() but types may not expose it for postgres_changes
      interface ChannelBuilderWithOn {
        on: (event: 'postgres_changes', opts: { event: string; schema: string; table: string; filter?: string }, callback: (p: RealtimePostgresChangesPayload<Record<string, unknown>>) => void) => { subscribe: () => RealtimeChannel };
      }
      const channelWithListener = (channelBuilder as ChannelBuilderWithOn).on(
        'postgres_changes',
        {
          event,
          schema: 'public',
          table,
          filter,
        },
        (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          callbackRef.current(payload);
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
  }, [table, event, filter, supabase]);
}

export function useTimesheetRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('timesheets', '*', callback);
}

export function useInspectionRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('van_inspections', '*', callback);
}

export function useAbsenceRealtime(callback: RealtimeCallback) {
  useRealtimeSubscription('absences', '*', callback);
}

