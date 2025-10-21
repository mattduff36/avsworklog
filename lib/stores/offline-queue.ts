import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createClient } from '@/lib/supabase/client';

export interface QueueItem {
  id: string;
  type: 'timesheet' | 'inspection';
  action: 'create' | 'update' | 'delete';
  data: Record<string, unknown>;
  timestamp: number;
  retries: number;
}

interface OfflineStore {
  queue: QueueItem[];
  addToQueue: (item: Omit<QueueItem, 'id' | 'timestamp' | 'retries'>) => void;
  removeFromQueue: (id: string) => void;
  processQueue: () => Promise<void>;
  clearQueue: () => void;
}

export const useOfflineStore = create<OfflineStore>()(
  persist(
    (set, get) => ({
      queue: [],

      addToQueue: (item) => {
        const queueItem: QueueItem = {
          ...item,
          id: `${Date.now()}-${Math.random()}`,
          timestamp: Date.now(),
          retries: 0,
        };
        set((state) => ({ queue: [...state.queue, queueItem] }));
      },

      removeFromQueue: (id) => {
        set((state) => ({
          queue: state.queue.filter((item) => item.id !== id),
        }));
      },

      processQueue: async () => {
        const { queue, removeFromQueue } = get();
        const supabase = createClient();

        for (const item of queue) {
          try {
            if (item.type === 'timesheet') {
              if (item.action === 'create') {
                await supabase.from('timesheets').insert(item.data as never);
              } else if (item.action === 'update') {
                await supabase
                  .from('timesheets')
                  .update(item.data as never)
                  .eq('id', (item.data as { id: string }).id);
              } else if (item.action === 'delete') {
                await supabase.from('timesheets').delete().eq('id', (item.data as { id: string }).id);
              }
            } else if (item.type === 'inspection') {
              if (item.action === 'create') {
                await supabase.from('vehicle_inspections').insert(item.data as never);
              } else if (item.action === 'update') {
                await supabase
                  .from('vehicle_inspections')
                  .update(item.data as never)
                  .eq('id', (item.data as { id: string }).id);
              } else if (item.action === 'delete') {
                await supabase
                  .from('vehicle_inspections')
                  .delete()
                  .eq('id', (item.data as { id: string }).id);
              }
            }

            // Remove from queue on success
            removeFromQueue(item.id);
          } catch (error) {
            console.error('Error processing queue item:', error);
            // Increment retry count
            set((state) => ({
              queue: state.queue.map((q) =>
                q.id === item.id ? { ...q, retries: q.retries + 1 } : q
              ),
            }));

            // Remove if too many retries
            if (item.retries >= 3) {
              removeFromQueue(item.id);
            }
          }
        }
      },

      clearQueue: () => {
        set({ queue: [] });
      },
    }),
    {
      name: 'offline-queue-storage',
    }
  )
);

