'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useDailyAllocationResourceJobs } from './hooks/use-daily-allocation-resource-jobs';
import type { JobCatalogueOption } from '@/types/job-catalogue';

export function DraftJobPicker({ value, onSelect }: {
  value: JobCatalogueOption | null;
  onSelect: (option: JobCatalogueOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const result = useDailyAllocationResourceJobs(search, open);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="w-full justify-between" aria-label="Select job code">
          {value?.value || 'Select job code'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-2" align="start">
        <Input aria-label="Search draft jobs" placeholder="Search code, customer or title" value={search}
          maxLength={100} onChange={(event) => setSearch(event.target.value)} />
        <div className="max-h-72 space-y-1 overflow-y-auto pt-2" aria-live="polite">
          {result.isLoading ? <p className="p-2 text-sm">Searching catalogue...</p> : null}
          {result.needsMoreCharacters ? <p className="p-2 text-sm">Enter at least 2 characters.</p> : null}
          {result.error ? <p role="alert" className="p-2 text-sm">{result.error.message}{' '}
            <button type="button" className="underline" onClick={result.retry}>Retry</button></p> : null}
          {!result.isLoading && !result.error && !result.needsMoreCharacters && result.jobs.length === 0
            ? <p className="p-2 text-sm">No matching active jobs.</p> : null}
          {result.jobs.map((job) => (
            <button type="button" className="block w-full rounded-md p-2 text-left text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              key={`${job.source_type}:${job.source_id}`} onClick={() => {
                onSelect({
                  value: job.job_code, label: job.job_code, source: job.source_type, sourceId: job.source_id,
                  customerName: job.customer_name, quoteTitle: job.title, siteAddress: job.site_address,
                  addressValid: job.address_valid ?? false, aliases: job.aliases || [],
                  isAmbiguous: false, blockReason: null,
                });
                setOpen(false);
              }}>
              <span className="block font-medium">{job.job_code}</span>
              <span className="block text-muted-foreground">{[job.customer_name, job.title].filter(Boolean).join(' · ')}</span>
              {!job.address_valid ? <span className="block text-amber-600 dark:text-amber-400">Site address missing or unconfirmed</span> : null}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
