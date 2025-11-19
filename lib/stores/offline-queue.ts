import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createClient } from '@/lib/supabase/client';
import { Database } from '@/types/database';

export interface QueueItem {
  id: string;
  type: 'timesheet' | 'inspection' | 'absence';
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

        type TimesheetInsert = Database['public']['Tables']['timesheets']['Insert'];
        type TimesheetUpdate = Database['public']['Tables']['timesheets']['Update'];
        type TimesheetEntryInsert = Database['public']['Tables']['timesheet_entries']['Insert'];
        type InspectionInsert = Database['public']['Tables']['vehicle_inspections']['Insert'];
        type InspectionUpdate = Database['public']['Tables']['vehicle_inspections']['Update'];
        type InspectionItemInsert = Database['public']['Tables']['inspection_items']['Insert'];
        type AbsenceInsert = Database['public']['Tables']['absences']['Insert'];
        type AbsenceUpdate = Database['public']['Tables']['absences']['Update'];

        for (const item of queue) {
          try {
            if (item.type === 'timesheet') {
              if (item.action === 'create') {
                // Extract entries from data
                const { entries, ...timesheetData } = item.data as TimesheetInsert & { entries?: unknown[] };
                
                // Insert timesheet
                const { data: timesheet, error: timesheetError } = await supabase
                  .from('timesheets')
                  .insert(timesheetData as TimesheetInsert)
                  .select()
                  .single();
                
                if (timesheetError) throw timesheetError;
                if (!timesheet) throw new Error('Failed to create timesheet');

                // Insert entries if they exist
                if (entries && Array.isArray(entries) && entries.length > 0) {
                  const entriesToInsert = entries.map((entry: Record<string, unknown>) => ({
                    ...entry,
                    timesheet_id: timesheet.id,
                  })) as TimesheetEntryInsert[];

                  const { error: entriesError } = await supabase
                    .from('timesheet_entries')
                    .insert(entriesToInsert);

                  if (entriesError) throw entriesError;
                }
              } else if (item.action === 'update') {
                await supabase
                  .from('timesheets')
                  .update(item.data as TimesheetUpdate)
                  .eq('id', (item.data as { id: string }).id);
              } else if (item.action === 'delete') {
                await supabase.from('timesheets').delete().eq('id', (item.data as { id: string }).id);
              }
            } else if (item.type === 'inspection') {
              if (item.action === 'create') {
                // Extract items from data
                const { items, ...inspectionData } = item.data as InspectionInsert & { items?: unknown[] };
                
                // Insert inspection
                const { data: inspection, error: inspectionError } = await supabase
                  .from('vehicle_inspections')
                  .insert(inspectionData as InspectionInsert)
                  .select()
                  .single();
                
                if (inspectionError) throw inspectionError;
                if (!inspection) throw new Error('Failed to create inspection');

                // Insert items if they exist
                if (items && Array.isArray(items) && items.length > 0) {
                  const itemsToInsert = items.map((inspItem: Record<string, unknown>) => ({
                    ...inspItem,
                    inspection_id: inspection.id,
                  })) as InspectionItemInsert[];

                  const { error: itemsError } = await supabase
                    .from('inspection_items')
                    .insert(itemsToInsert);

                  if (itemsError) throw itemsError;
                }
              } else if (item.action === 'update') {
                await supabase
                  .from('vehicle_inspections')
                  .update(item.data as InspectionUpdate)
                  .eq('id', (item.data as { id: string }).id);
              } else if (item.action === 'delete') {
                await supabase
                  .from('vehicle_inspections')
                  .delete()
                  .eq('id', (item.data as { id: string }).id);
              }
            } else if (item.type === 'absence') {
              if (item.action === 'create') {
                const { error } = await supabase
                  .from('absences')
                  .insert(item.data as AbsenceInsert)
                  .select()
                  .single();
                
                if (error) throw error;
              } else if (item.action === 'update') {
                await supabase
                  .from('absences')
                  .update(item.data as AbsenceUpdate)
                  .eq('id', (item.data as { id: string }).id);
              } else if (item.action === 'delete') {
                await supabase
                  .from('absences')
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

