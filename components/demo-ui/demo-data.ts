'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/hooks/useAuth';
import { useBrowserSupabaseClient } from '@/lib/hooks/useBrowserSupabaseClient';
import type { Timesheet, TimesheetEntry } from '@/types/timesheet';

interface ApiErrorPayload {
  error?: string;
}

interface UseDemoApiDataOptions {
  enabled?: boolean;
}

export async function fetchDemoJson<Payload>(url: string): Promise<Payload> {
  const response = await fetch(url, { cache: 'no-store' });
  const payload = (await response.json().catch(() => null)) as
    | (Payload & ApiErrorPayload)
    | null;

  if (!response.ok || !payload) {
    throw new Error(payload?.error || 'Live data could not be loaded.');
  }

  return payload;
}

export function useDemoApiData<Payload>(
  key: string,
  url: string,
  options: UseDemoApiDataOptions = {}
) {
  return useQuery({
    queryKey: ['demo-ui', key, url],
    queryFn: () => fetchDemoJson<Payload>(url),
    enabled: options.enabled !== false,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export interface DemoTimesheetRow extends Timesheet {
  profile?: {
    full_name: string | null;
    employee_id: string | null;
  } | null;
}

export function useDemoTimesheets() {
  const { user, isManager, isAdmin, isSuperAdmin } = useAuth();
  const supabase = useBrowserSupabaseClient();
  const elevatedScope = isManager || isAdmin || isSuperAdmin;

  const query = useQuery({
    queryKey: ['demo-ui', 'timesheets', 'personal', user?.id || null],
    enabled: Boolean(user?.id) && !elevatedScope,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('timesheets')
        .select(`
          *,
          profile:profiles!timesheets_user_id_fkey(full_name, employee_id)
        `)
        .eq('user_id', user!.id)
        .order('week_ending', { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data || []) as unknown as DemoTimesheetRow[];
    },
  });

  return {
    ...query,
    scopeUnavailable: elevatedScope,
  };
}

export interface DemoTimesheetDetail extends Timesheet {
  profile?: {
    full_name: string | null;
    employee_id: string | null;
  } | null;
  entries: TimesheetEntry[];
}

export function useDemoTimesheetDetail(id: string | null) {
  const { user, isManager, isAdmin, isSuperAdmin } = useAuth();
  const supabase = useBrowserSupabaseClient();

  return useQuery({
    queryKey: ['demo-ui', 'timesheet-detail', id, user?.id || null],
    enabled: Boolean(id && user?.id),
    queryFn: async () => {
      const { data: timesheet, error: timesheetError } = await supabase
        .from('timesheets')
        .select(`
          *,
          profile:profiles!timesheets_user_id_fkey(full_name, employee_id)
        `)
        .eq('id', id!)
        .maybeSingle();

      if (timesheetError) throw timesheetError;
      if (!timesheet) throw new Error('Timesheet not found.');

      const elevatedScope = isManager || isAdmin || isSuperAdmin;
      if (!elevatedScope && timesheet.user_id !== user!.id) {
        throw new Error('You do not have permission to view this timesheet.');
      }

      const { data: entries, error: entriesError } = await supabase
        .from('timesheet_entries')
        .select('*')
        .eq('timesheet_id', id!)
        .order('day_of_week');

      if (entriesError) throw entriesError;
      return {
        ...timesheet,
        entries: (entries || []) as TimesheetEntry[],
      } as unknown as DemoTimesheetDetail;
    },
  });
}

export interface DemoAbsenceRow {
  id: string;
  date: string;
  end_date: string | null;
  duration_days: number | null;
  is_half_day: boolean | null;
  status: string;
  notes: string | null;
  absence_reasons: {
    name: string;
  } | null;
}

export function useDemoAbsences() {
  const { profile } = useAuth();
  const supabase = useBrowserSupabaseClient();

  return useQuery({
    queryKey: ['demo-ui', 'absence', 'personal', profile?.id || null],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('absences')
        .select(`
          id,
          date,
          end_date,
          duration_days,
          is_half_day,
          status,
          notes,
          absence_reasons(name)
        `)
        .eq('profile_id', profile!.id)
        .order('date', { ascending: false })
        .limit(100);

      if (error) throw error;
      return (data || []) as unknown as DemoAbsenceRow[];
    },
  });
}

export interface DemoFleetAsset {
  id: string;
  identifier: string;
  nickname: string | null;
  status: string;
  category: string | null;
  kind: 'Van' | 'Plant' | 'HGV';
  lastInspectionDate?: string | null;
}

interface VansResponse {
  vehicles: Array<{
    id: string;
    reg_number: string | null;
    nickname: string | null;
    status: string | null;
    last_inspection_date?: string | null;
    van_categories?: { name?: string | null } | null;
  }>;
}

interface HgvsResponse {
  hgvs: Array<{
    id: string;
    reg_number: string | null;
    nickname: string | null;
    status: string | null;
    hgv_categories?: { name?: string | null } | null;
  }>;
}

export function useDemoFleet() {
  const supabase = useBrowserSupabaseClient();

  return useQuery({
    queryKey: ['demo-ui', 'fleet'],
    queryFn: async () => {
      const [vansPayload, hgvsPayload, plantResult] = await Promise.all([
        fetchDemoJson<VansResponse>('/api/admin/vans'),
        fetchDemoJson<HgvsResponse>('/api/admin/hgvs'),
        supabase
          .from('plant')
          .select('id, plant_id, nickname, status, van_categories(name)')
          .eq('status', 'active')
          .order('plant_id'),
      ]);

      if (plantResult.error) throw plantResult.error;

      const vans: DemoFleetAsset[] = vansPayload.vehicles.map((asset) => ({
        id: asset.id,
        identifier: asset.reg_number || 'No registration',
        nickname: asset.nickname,
        status: asset.status || 'active',
        category: asset.van_categories?.name || null,
        kind: 'Van',
        lastInspectionDate: asset.last_inspection_date || null,
      }));
      const plant: DemoFleetAsset[] = (plantResult.data || []).map((asset) => ({
        id: asset.id,
        identifier: asset.plant_id || 'No plant ID',
        nickname: asset.nickname,
        status: asset.status || 'active',
        category: asset.van_categories?.name || null,
        kind: 'Plant',
      }));
      const hgvs: DemoFleetAsset[] = hgvsPayload.hgvs.map((asset) => ({
        id: asset.id,
        identifier: asset.reg_number || 'No registration',
        nickname: asset.nickname,
        status: asset.status || 'active',
        category: asset.hgv_categories?.name || null,
        kind: 'HGV',
      }));

      return [...vans, ...plant, ...hgvs];
    },
  });
}

export interface DemoWorkshopTask {
  id: string;
  title: string | null;
  description: string | null;
  status: string;
  priority: string | null;
  created_at: string;
  vans?: { reg_number: string | null; nickname: string | null } | null;
  hgvs?: { reg_number: string | null; nickname: string | null } | null;
  plant?: { plant_id: string | null; nickname: string | null } | null;
  workshop_task_categories?: { name: string | null } | null;
  workshop_task_subcategories?: { name: string | null } | null;
}

export function useDemoWorkshopTasks() {
  const supabase = useBrowserSupabaseClient();

  return useQuery({
    queryKey: ['demo-ui', 'workshop-tasks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('actions')
        .select(`
          id,
          title,
          description,
          status,
          priority,
          created_at,
          vans(reg_number, nickname),
          hgvs(reg_number, nickname),
          plant(plant_id, nickname),
          workshop_task_categories(name),
          workshop_task_subcategories!workshop_subcategory_id(name)
        `)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .order('created_at', { ascending: false })
        .limit(150);

      if (error) throw error;
      return (data || []) as unknown as DemoWorkshopTask[];
    },
  });
}
