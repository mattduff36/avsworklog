import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from 'react';
import { toast } from 'sonner';
import { getRecentVehicleIds } from '@/lib/utils/recentVehicles';
import {
  getWorkshopActiveTaskOrFilter,
  getWorkshopAssetTabColumn,
  getWorkshopTaskArchiveCutoffIso,
  getWorkshopVehicleOrFilter,
  shouldIncludeWorkshopTaskInActiveList,
  takeLatestArchivedCount,
  type WorkshopArchiveAssetTab,
} from '@/lib/workshop-tasks/archive';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Action, Category, Subcategory, Vehicle } from '../types';

export const WORKSHOP_TASK_LIST_SELECT = `
          *,
          vans (
            reg_number,
            nickname
          ),
          hgvs (
            reg_number,
            nickname
          ),
          plant (
            plant_id,
            nickname
          ),
          workshop_task_categories (
            id,
            name,
            slug,
            ui_color,
            completion_updates
          ),
          workshop_task_subcategories!workshop_subcategory_id (
            id,
            name,
            slug,
            ui_color,
            workshop_task_categories (
              id,
              name,
              slug,
              ui_color,
              completion_updates
            )
          )
        `;

function isTransientNetworkError(err: unknown): boolean {
  return (
    err instanceof TypeError &&
    /failed to fetch|load failed|networkerror|network request failed/i.test(err.message)
  );
}

function applyWorkshopListFilters<T extends { or: (filters: string) => T; not: (column: string, operator: 'is', value: null) => T }>(
  query: T,
  options: { vehicleFilter: string; assetTab?: WorkshopArchiveAssetTab }
): T {
  let nextQuery = query;
  const vehicleOrFilter = getWorkshopVehicleOrFilter(options.vehicleFilter);
  if (vehicleOrFilter) {
    nextQuery = nextQuery.or(vehicleOrFilter);
  }
  const assetColumn = options.assetTab ? getWorkshopAssetTabColumn(options.assetTab) : null;
  if (assetColumn) {
    nextQuery = nextQuery.not(assetColumn, 'is', null);
  }
  return nextQuery;
}

async function hydrateWorkshopTasks(
  supabase: SupabaseClient,
  rawTasks: Action[],
  isCurrentRequest: () => boolean
): Promise<Action[] | null> {
  let normalizedTasks = rawTasks;
  const inspectionIdsNeedingAsset = Array.from(
    new Set(
      normalizedTasks
        .filter(
          (task) =>
            Boolean(task.inspection_id) &&
            !task.van_id &&
            !task.hgv_id &&
            !task.plant_id
        )
        .map((task) => task.inspection_id as string)
    )
  );

  if (inspectionIdsNeedingAsset.length > 0) {
    const [
      { data: vanInspectionRows, error: vanInspectionError },
      { data: hgvInspectionRows, error: hgvInspectionError },
      { data: plantInspectionRows, error: plantInspectionError },
    ] = await Promise.all([
      supabase
        .from('van_inspections')
        .select(`
              id,
              van_id,
              vans (
                reg_number,
                nickname
              )
            `)
        .in('id', inspectionIdsNeedingAsset),
      supabase
        .from('hgv_inspections')
        .select(`
              id,
              hgv_id,
              hgvs (
                reg_number,
                nickname
              )
            `)
        .in('id', inspectionIdsNeedingAsset),
      supabase
        .from('plant_inspections')
        .select(`
              id,
              plant_id,
              plant (
                plant_id,
                nickname
              )
            `)
        .in('id', inspectionIdsNeedingAsset),
    ]);

    if (!isCurrentRequest()) return null;

    if (vanInspectionError) {
      console.warn('Unable to load van inspection fallback assets:', vanInspectionError.message);
    }
    if (hgvInspectionError) {
      console.warn('Unable to load HGV inspection fallback assets:', hgvInspectionError.message);
    }
    if (plantInspectionError) {
      console.warn('Unable to load plant inspection fallback assets:', plantInspectionError.message);
    }

    const vanByInspectionId = new Map(
      ((vanInspectionRows || []) as unknown as Array<{
        id: string;
        van_id: string | null;
        vans: { reg_number: string; nickname: string | null } | null;
      }>).map((row) => [row.id, row])
    );
    const hgvByInspectionId = new Map(
      ((hgvInspectionRows || []) as unknown as Array<{
        id: string;
        hgv_id: string | null;
        hgvs: { reg_number: string; nickname: string | null } | null;
      }>).map((row) => [row.id, row])
    );
    const plantByInspectionId = new Map(
      ((plantInspectionRows || []) as unknown as Array<{
        id: string;
        plant_id: string | null;
        plant: { plant_id: string; nickname: string | null } | null;
      }>).map((row) => [row.id, row])
    );

    normalizedTasks = normalizedTasks.map((task): Action => {
      if (task.van_id || task.hgv_id || task.plant_id || !task.inspection_id) {
        return task;
      }

      const vanFallback = vanByInspectionId.get(task.inspection_id);
      if (vanFallback?.van_id) {
        return {
          ...task,
          van_id: vanFallback.van_id,
          vans: task.vans || vanFallback.vans || undefined,
        };
      }

      const hgvFallback = hgvByInspectionId.get(task.inspection_id);
      if (hgvFallback?.hgv_id) {
        return {
          ...task,
          hgv_id: hgvFallback.hgv_id,
          hgvs: task.hgvs || hgvFallback.hgvs || undefined,
        };
      }

      const plantFallback = plantByInspectionId.get(task.inspection_id);
      if (plantFallback?.plant_id) {
        return {
          ...task,
          plant_id: plantFallback.plant_id,
          plant: task.plant || plantFallback.plant || undefined,
        };
      }

      return task;
    });
  }

  const createdByIds = Array.from(
    new Set(normalizedTasks.map((task: Action) => task.created_by).filter(Boolean))
  );
  let profileMap = new Map<string, { full_name: string | null }>();
  if (createdByIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', createdByIds);
    if (!isCurrentRequest()) return null;
    profileMap = new Map(
      (profiles || []).map((profile: { id: string; full_name: string | null }) => [profile.id, { full_name: profile.full_name }])
    );
  }

  return normalizedTasks.map((task: Action) => ({
    ...task,
    profiles_created: task.created_by
      ? profileMap.get(task.created_by) || null
      : null,
  }));
}

async function mergeAttachmentCounts(
  supabase: SupabaseClient,
  taskIds: string[],
  setTaskAttachmentCounts: Dispatch<SetStateAction<Map<string, number>>>,
  replaceFetchedIds: boolean
) {
  if (taskIds.length === 0) {
    return;
  }

  const { data: attachmentData } = await supabase
    .from('workshop_task_attachments')
    .select('task_id')
    .in('task_id', taskIds);

  const fetchedCounts = new Map<string, number>();
  (attachmentData || []).forEach((att: { task_id: string }) => {
    fetchedCounts.set(att.task_id, (fetchedCounts.get(att.task_id) || 0) + 1);
  });

  const fetchedIdSet = new Set(taskIds);
  setTaskAttachmentCounts((prev) => {
    const next = new Map<string, number>();
    if (replaceFetchedIds) {
      for (const [id, count] of prev) {
        if (!fetchedIdSet.has(id)) {
          next.set(id, count);
        }
      }
    } else {
      for (const [id, count] of prev) {
        next.set(id, count);
      }
    }
    for (const [id, count] of fetchedCounts) {
      next.set(id, count);
    }
    return next;
  });
}

interface UseWorkshopTasksFetchersParams {
  supabase: SupabaseClient;
  userId: string | null | undefined;
  vehicleFilter: string;
  setLoading: (loading: boolean) => void;
  setTasks: (tasks: Action[]) => void;
  setVehicles: (vehicles: Vehicle[]) => void;
  setRecentVehicleIds: (ids: string[]) => void;
  setTaskAttachmentCounts: Dispatch<SetStateAction<Map<string, number>>>;
  setCategories: (categories: Category[]) => void;
  setPlantCategories: (categories: Category[]) => void;
  setHgvCategories: (categories: Category[]) => void;
  setSubcategories: (subcategories: Subcategory[]) => void;
  setPlantSubcategories: (subcategories: Subcategory[]) => void;
  setHgvSubcategories: (subcategories: Subcategory[]) => void;
  setCurrentMeterReading: (value: number | null) => void;
  setMeterReadingType: (type: 'mileage' | 'hours') => void;
}

export function useWorkshopTasksFetchers({
  supabase,
  userId,
  vehicleFilter,
  setLoading,
  setTasks,
  setVehicles,
  setRecentVehicleIds,
  setTaskAttachmentCounts,
  setCategories,
  setPlantCategories,
  setHgvCategories,
  setSubcategories,
  setPlantSubcategories,
  setHgvSubcategories,
  setCurrentMeterReading,
  setMeterReadingType,
}: UseWorkshopTasksFetchersParams) {
  const fetchTasksRequestIdRef = useRef(0);
  const fetchArchivedRequestIdRef = useRef(0);
  const fetchArchivedCountRequestIdRef = useRef(0);

  const fetchTasks = useCallback(async () => {
    if (!supabase) return;

    const requestId = fetchTasksRequestIdRef.current + 1;
    fetchTasksRequestIdRef.current = requestId;
    const isCurrentRequest = () => fetchTasksRequestIdRef.current === requestId;

    try {
      setLoading(true);

      let query = supabase
        .from('actions')
        .select(WORKSHOP_TASK_LIST_SELECT)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .or(getWorkshopActiveTaskOrFilter())
        .order('created_at', { ascending: false });

      query = applyWorkshopListFilters(query, { vehicleFilter });

      const { data, error } = await query;

      if (error) throw error;
      if (!isCurrentRequest()) return;

      const tasksWithProfiles = await hydrateWorkshopTasks(
        supabase,
        (data || []) as Action[],
        isCurrentRequest
      );
      if (!tasksWithProfiles || !isCurrentRequest()) return;

      const activeTasks = tasksWithProfiles.filter((task) => shouldIncludeWorkshopTaskInActiveList(task));
      setTasks(activeTasks);

      await mergeAttachmentCounts(
        supabase,
        activeTasks.map((task) => task.id),
        setTaskAttachmentCounts,
        true
      );
    } catch (err) {
      if (!isCurrentRequest()) return;
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching tasks (transient):', (err as Error).message);
      } else {
        console.error('Error fetching tasks:', err instanceof Error ? err.message : JSON.stringify(err));
      }
      toast.error('Failed to load workshop tasks');
    } finally {
      if (isCurrentRequest()) {
        setLoading(false);
      }
    }
  }, [setLoading, setTaskAttachmentCounts, setTasks, supabase, vehicleFilter]);

  const fetchCategories = useCallback(async () => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .select('id, name, slug, is_active, sort_order')
        .eq('applies_to', 'van')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setCategories(data || []);
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching categories (transient):', (err as Error).message);
      } else {
        console.error('Error fetching categories:', err instanceof Error ? err.message : JSON.stringify(err));
      }
    }
  }, [setCategories, supabase]);

  const fetchPlantCategories = useCallback(async () => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .select('id, name, slug, is_active, sort_order')
        .eq('applies_to', 'plant')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setPlantCategories(data || []);
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching plant categories (transient):', (err as Error).message);
      } else {
        console.error('Error fetching plant categories:', err instanceof Error ? err.message : JSON.stringify(err));
      }
    }
  }, [setPlantCategories, supabase]);

  const fetchHgvCategories = useCallback(async () => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('workshop_task_categories')
        .select('id, name, slug, is_active, sort_order')
        .eq('applies_to', 'hgv')
        .eq('is_active', true)
        .order('name');

      if (error) throw error;
      setHgvCategories(data || []);
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching hgv categories (transient):', (err as Error).message);
      } else {
        console.error('Error fetching hgv categories:', err instanceof Error ? err.message : JSON.stringify(err));
      }
    }
  }, [setHgvCategories, supabase]);

  const fetchSubcategories = useCallback(async () => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('workshop_task_subcategories')
        .select(`
          id,
          category_id,
          name,
          slug,
          is_active,
          sort_order,
          workshop_task_categories!inner (applies_to)
        `)
        .eq('is_active', true)
        .eq('workshop_task_categories.applies_to', 'van')
        .order('name');

      if (error) throw error;
      setSubcategories(data || []);
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching subcategories (transient):', (err as Error).message);
      } else {
        console.error('Error fetching subcategories:', err instanceof Error ? err.message : JSON.stringify(err));
      }
    }
  }, [setSubcategories, supabase]);

  useEffect(() => {
    if (!userId || !supabase) return;

    const fetchVehiclesInner = async () => {
      try {
        const { data: vehicleData, error: vehicleError } = await supabase
          .from('vans')
          .select('id, reg_number, nickname, van_categories(name)')
          .eq('status', 'active')
          .order('reg_number');

        if (vehicleError) throw vehicleError;

        const { data: plantData, error: plantError } = await supabase
          .from('plant')
          .select('id, plant_id, nickname, serial_number')
          .eq('status', 'active')
          .order('plant_id');

        if (plantError) throw plantError;

        const { data: hgvData, error: hgvError } = await supabase
          .from('hgvs')
          .select('id, reg_number, nickname')
          .eq('status', 'active')
          .order('reg_number');

        if (hgvError) throw hgvError;

        const combinedVehicles = [
          ...(vehicleData || []).map((v) => {
            const categories = v.van_categories as { name: string } | { name: string }[] | null;
            const categoryName = Array.isArray(categories)
              ? categories[0]?.name ?? null
              : categories?.name ?? null;
            return {
              id: v.id,
              reg_number: v.reg_number ?? '',
              plant_id: null,
              nickname: v.nickname,
              category: categoryName,
              asset_type: 'van' as const,
            };
          }),
          ...(plantData || []).map((p: { id: string; plant_id: string; nickname: string | null }) => ({
            id: p.id,
            reg_number: '',
            plant_id: p.plant_id,
            nickname: p.nickname,
            category: null,
            asset_type: 'plant' as const,
          })),
          ...(hgvData || []).map((v: { id: string; reg_number: string | null; nickname: string | null }) => ({
            id: v.id,
            reg_number: v.reg_number ?? '',
            plant_id: null,
            nickname: v.nickname,
            category: null,
            asset_type: 'hgv' as const,
          })),
        ];

        setVehicles(combinedVehicles);
      } catch (err) {
        if (isTransientNetworkError(err)) {
          console.warn('Network error fetching vehicles (transient):', (err as Error).message);
        } else {
          console.error('Error fetching vehicles:', err instanceof Error ? err.message : JSON.stringify(err));
        }
      }
    };

    const fetchPlantSubcategoriesInner = async () => {
      try {
        const { data, error } = await supabase
          .from('workshop_task_subcategories')
          .select(`
              id,
              category_id,
              name,
              slug,
              is_active,
              sort_order,
              workshop_task_categories!inner (applies_to)
            `)
          .eq('is_active', true)
          .eq('workshop_task_categories.applies_to', 'plant')
          .order('name');

        if (error) throw error;
        setPlantSubcategories(data || []);
      } catch (err) {
        if (isTransientNetworkError(err)) {
          console.warn('Network error fetching plant subcategories (transient):', (err as Error).message);
        } else {
          console.error('Error fetching plant subcategories:', err instanceof Error ? err.message : JSON.stringify(err));
        }
      }
    };

    const fetchHgvSubcategoriesInner = async () => {
      try {
        const { data, error } = await supabase
          .from('workshop_task_subcategories')
          .select(`
              id,
              category_id,
              name,
              slug,
              is_active,
              sort_order,
              workshop_task_categories!inner (applies_to)
            `)
          .eq('is_active', true)
          .eq('workshop_task_categories.applies_to', 'hgv')
          .order('name');

        if (error) throw error;
        setHgvSubcategories(data || []);
      } catch (err) {
        if (isTransientNetworkError(err)) {
          console.warn('Network error fetching hgv subcategories (transient):', (err as Error).message);
        } else {
          console.error('Error fetching hgv subcategories:', err instanceof Error ? err.message : JSON.stringify(err));
        }
      }
    };

    fetchTasks();
    fetchVehiclesInner();
    fetchCategories();
    fetchPlantCategories();
    fetchHgvCategories();
    fetchSubcategories();
    fetchPlantSubcategoriesInner();
    fetchHgvSubcategoriesInner();
    setRecentVehicleIds(getRecentVehicleIds(userId));
  }, [
    userId,
    vehicleFilter,
    fetchTasks,
    fetchCategories,
    fetchPlantCategories,
    fetchHgvCategories,
    fetchSubcategories,
    setRecentVehicleIds,
    setVehicles,
    setPlantSubcategories,
    setHgvSubcategories,
    supabase,
  ]);

  const fetchCurrentMeterReading = useCallback(async (vehicleId: string) => {
    if (!supabase) {
      setCurrentMeterReading(null);
      return;
    }

    try {
      let isPlant = false;
      let isHgv = false;

      const { data: vehicleData } = await supabase
        .from('vans')
        .select('id')
        .eq('id', vehicleId)
        .maybeSingle();

      if (!vehicleData) {
        const { data: hgvData } = await supabase
          .from('hgvs')
          .select('id')
          .eq('id', vehicleId)
          .maybeSingle();

        if (hgvData) {
          isHgv = true;
        } else {
          const { data: plantData } = await supabase
            .from('plant')
            .select('id')
            .eq('id', vehicleId)
            .maybeSingle();

          if (plantData) {
            isPlant = true;
          } else {
            setCurrentMeterReading(null);
            setMeterReadingType('mileage');
            return;
          }
        }
      }

      setMeterReadingType(isPlant ? 'hours' : 'mileage');

      const { data, error } = await supabase
        .from('vehicle_maintenance')
        .select(isPlant ? 'current_hours' : 'current_mileage')
        .eq(isPlant ? 'plant_id' : (isHgv ? 'hgv_id' : 'van_id'), vehicleId)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(2);

      if (error) {
        if (error.code === 'PGRST116') {
          setCurrentMeterReading(null);
          return;
        }
        throw error;
      }
      if ((data?.length ?? 0) > 1) {
        console.warn('Multiple vehicle_maintenance rows found for meter reading; using the latest row.', {
          vehicleId,
          assetType: isPlant ? 'plant' : (isHgv ? 'hgv' : 'van'),
        });
      }
      const meterData = ((data || [])[0] as { current_hours?: number | null; current_mileage?: number | null } | undefined) ?? null;
      setCurrentMeterReading(isPlant ? (meterData?.current_hours || null) : (meterData?.current_mileage || null));
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching meter reading (transient):', (err as Error).message);
      } else {
        console.error('Error fetching current meter reading:', err instanceof Error ? err.message : JSON.stringify(err));
      }
      setCurrentMeterReading(null);
    }
  }, [setCurrentMeterReading, setMeterReadingType, supabase]);

  const fetchArchivedCount = useCallback(async (assetTab: WorkshopArchiveAssetTab = 'all') => {
    if (!supabase) return null;

    const requestId = fetchArchivedCountRequestIdRef.current + 1;
    fetchArchivedCountRequestIdRef.current = requestId;

    try {
      let query = supabase
        .from('actions')
        .select('id', { count: 'exact', head: true })
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .eq('status', 'completed')
        .lt('actioned_at', getWorkshopTaskArchiveCutoffIso());

      query = applyWorkshopListFilters(query, { vehicleFilter, assetTab });

      const { count, error } = await query;
      if (error) throw error;
      return takeLatestArchivedCount(requestId, fetchArchivedCountRequestIdRef.current, count ?? 0);
    } catch (err) {
      if (takeLatestArchivedCount(requestId, fetchArchivedCountRequestIdRef.current, 0) === null) return null;
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching archived task count (transient):', (err as Error).message);
      } else {
        console.error('Error fetching archived task count:', err instanceof Error ? err.message : JSON.stringify(err));
      }
      return 0;
    }
  }, [supabase, vehicleFilter]);

  const fetchArchivedTasks = useCallback(async (assetTab: WorkshopArchiveAssetTab = 'all') => {
    if (!supabase) return [] as Action[];

    const requestId = fetchArchivedRequestIdRef.current + 1;
    fetchArchivedRequestIdRef.current = requestId;
    const isCurrentRequest = () => fetchArchivedRequestIdRef.current === requestId;

    try {
      let query = supabase
        .from('actions')
        .select(WORKSHOP_TASK_LIST_SELECT)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .eq('status', 'completed')
        .lt('actioned_at', getWorkshopTaskArchiveCutoffIso())
        .order('actioned_at', { ascending: false });

      query = applyWorkshopListFilters(query, { vehicleFilter, assetTab });

      const { data, error } = await query;
      if (error) throw error;
      if (!isCurrentRequest()) return null;

      const tasksWithProfiles = await hydrateWorkshopTasks(
        supabase,
        (data || []) as Action[],
        isCurrentRequest
      );
      if (!tasksWithProfiles || !isCurrentRequest()) return null;

      await mergeAttachmentCounts(
        supabase,
        tasksWithProfiles.map((task) => task.id),
        setTaskAttachmentCounts,
        false
      );

      return tasksWithProfiles;
    } catch (err) {
      if (!isCurrentRequest()) return null;
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching archived tasks (transient):', (err as Error).message);
      } else {
        console.error('Error fetching archived tasks:', err instanceof Error ? err.message : JSON.stringify(err));
      }
      toast.error('Failed to load archived workshop tasks');
      return [] as Action[];
    }
  }, [setTaskAttachmentCounts, supabase, vehicleFilter]);

  const fetchTaskById = useCallback(async (taskId: string) => {
    if (!supabase || !taskId) return null;

    try {
      const { data, error } = await supabase
        .from('actions')
        .select(WORKSHOP_TASK_LIST_SELECT)
        .eq('id', taskId)
        .in('action_type', ['inspection_defect', 'workshop_vehicle_task'])
        .maybeSingle();

      if (error) throw error;
      if (!data) return null;

      const hydrated = await hydrateWorkshopTasks(supabase, [data as Action], () => true);
      return hydrated?.[0] ?? null;
    } catch (err) {
      if (isTransientNetworkError(err)) {
        console.warn('Network error fetching workshop task (transient):', (err as Error).message);
      } else {
        console.error('Error fetching workshop task:', err instanceof Error ? err.message : JSON.stringify(err));
      }
      return null;
    }
  }, [supabase]);

  return {
    fetchTasks,
    fetchArchivedCount,
    fetchArchivedTasks,
    fetchTaskById,
    fetchCategories,
    fetchPlantCategories,
    fetchHgvCategories,
    fetchSubcategories,
    fetchCurrentMeterReading,
  };
}
