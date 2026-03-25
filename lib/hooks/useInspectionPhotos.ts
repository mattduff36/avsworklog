'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { groupInspectionPhotosByItem, type InspectionPhotoMap } from '@/lib/inspection-photos';
import type { InspectionPhoto } from '@/types/inspection';

interface UseInspectionPhotosOptions {
  enabled?: boolean;
}

export function useInspectionPhotos(
  inspectionId: string | null | undefined,
  options: UseInspectionPhotosOptions = {}
) {
  const { enabled = true } = options;
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPhotos = useCallback(async () => {
    if (!inspectionId || !enabled) {
      setPhotos([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/inspection-photos?inspectionId=${encodeURIComponent(inspectionId)}`,
        { credentials: 'include' }
      );

      const payload = (await response.json()) as {
        error?: string;
        photos?: InspectionPhoto[];
      };

      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load inspection photos');
      }

      setPhotos(payload.photos ?? []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load inspection photos');
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, inspectionId]);

  useEffect(() => {
    void fetchPhotos();
  }, [fetchPhotos]);

  const photoMap = useMemo<InspectionPhotoMap>(() => groupInspectionPhotosByItem(photos), [photos]);

  return {
    photos,
    photoMap,
    loading,
    error,
    refresh: fetchPhotos,
  };
}
