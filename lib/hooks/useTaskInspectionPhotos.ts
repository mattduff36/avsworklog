'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InspectionPhoto } from '@/types/inspection';

interface UseTaskInspectionPhotosOptions {
  enabled?: boolean;
}

export function useTaskInspectionPhotos(
  taskIds: string[],
  options: UseTaskInspectionPhotosOptions = {}
) {
  const { enabled = true } = options;
  const taskIdsKey = JSON.stringify(taskIds);
  const normalizedTaskIds = useMemo(
    () => {
      const parsedTaskIds = JSON.parse(taskIdsKey) as string[];
      return Array.from(new Set(parsedTaskIds.filter(Boolean))).sort();
    },
    [taskIdsKey]
  );
  const [photosByTask, setPhotosByTask] = useState<Record<string, InspectionPhoto[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPhotos = useCallback(async () => {
    if (!enabled || normalizedTaskIds.length === 0) {
      setPhotosByTask({});
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/inspection-photos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({ taskIds: normalizedTaskIds }),
      });

      const payload = (await response.json()) as {
        error?: string;
        photosByTask?: Record<string, InspectionPhoto[]>;
      };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load task photos');
      }

      setPhotosByTask(payload.photosByTask ?? {});
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load task photos');
      setPhotosByTask({});
    } finally {
      setLoading(false);
    }
  }, [enabled, normalizedTaskIds]);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  return {
    photosByTask,
    loading,
    error,
    refresh: fetchPhotos,
  };
}
