'use client';

import { useCallback, useEffect, useState } from 'react';
import type { JobCatalogueOption } from '@/types/job-catalogue';

interface JobCatalogueResponse {
  job_codes?: JobCatalogueOption[];
  error?: string;
}

let pendingJobCatalogueOptions: Promise<JobCatalogueOption[]> | null = null;

async function fetchJobCatalogueOptions(): Promise<JobCatalogueOption[]> {
  const response = await fetch('/api/job-codes', { cache: 'no-store' });
  const payload = (await response.json()) as JobCatalogueResponse;

  if (!response.ok) {
    throw new Error(payload.error || 'Unable to load job codes');
  }

  return payload.job_codes || [];
}

function loadJobCatalogueOptions(): Promise<JobCatalogueOption[]> {
  pendingJobCatalogueOptions ||= fetchJobCatalogueOptions()
    .finally(() => {
      pendingJobCatalogueOptions = null;
    });

  return pendingJobCatalogueOptions;
}

export function useJobCatalogueOptions() {
  const [options, setOptions] = useState<JobCatalogueOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  const retry = useCallback(() => {
    setOptions([]);
    setError(null);
    setIsLoading(true);
    setRequestVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    let isMounted = true;

    loadJobCatalogueOptions()
      .then((nextOptions) => {
        if (!isMounted) return;
        setOptions(nextOptions);
      })
      .catch((fetchError) => {
        if (!isMounted) return;
        setOptions([]);
        setError(fetchError instanceof Error ? fetchError.message : 'Unable to load job codes');
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [requestVersion]);

  return { options, isLoading, error, retry };
}
