'use client';

import { useEffect, useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { getJobCatalogueBlockMessage } from '@/lib/utils/job-catalogue';
import type { JobCatalogueOption } from '@/types/job-catalogue';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface JobCataloguePickerProps {
  value: string | null;
  sourceId?: string | null;
  disabled?: boolean;
  id?: string;
  className?: string;
  onSelect: (option: JobCatalogueOption | null) => void;
}

let cachedOptions: JobCatalogueOption[] | null = null;

async function fetchJobCatalogueOptions(): Promise<JobCatalogueOption[]> {
  const response = await fetch('/api/job-codes', { cache: 'no-store' });
  const payload = await response.json() as { job_codes?: JobCatalogueOption[]; error?: string };
  if (!response.ok) throw new Error(payload.error || 'Unable to load job codes');
  return payload.job_codes || [];
}

export function JobCataloguePicker({ value, sourceId, disabled, id, className, onSelect }: JobCataloguePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<JobCatalogueOption[]>(cachedOptions || []);
  const [loading, setLoading] = useState(!cachedOptions);

  useEffect(() => {
    let mounted = true;
    fetchJobCatalogueOptions()
      .then((next) => {
        if (!mounted) return;
        cachedOptions = next;
        setOptions(next);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selected = options.find((option) => (
    sourceId ? option.sourceId === sourceId : option.value === value
  )) || null;

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return options.slice(0, 80);
    return options.filter((option) => (
      option.value.toLowerCase().includes(term)
      || (option.customerName || '').toLowerCase().includes(term)
      || (option.quoteTitle || '').toLowerCase().includes(term)
      || (option.siteAddress || '').toLowerCase().includes(term)
    )).slice(0, 80);
  }, [options, query]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          id={id}
          className={cn('w-full justify-between font-normal', className)}
        >
          <span className={cn('truncate', !(selected?.value || value) && 'text-muted-foreground')}>
            {selected?.value || value || 'Select job code'}
          </span>
          <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(28rem,calc(100vw-2rem))] p-2" align="start">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search job codes"
          className="mb-2"
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {loading ? <p className="px-2 py-3 text-sm text-muted-foreground">Loading job codes…</p> : null}
          {!loading && filtered.length === 0 ? (
            <p className="px-2 py-3 text-sm text-muted-foreground">No matching catalogue jobs.</p>
          ) : null}
          <button
            type="button"
            className="w-full rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
            onClick={() => {
              onSelect(null);
              setOpen(false);
            }}
          >
            Clear selection
          </button>
          {filtered.map((option) => {
            const blocked = Boolean(option.blockReason);
            return (
              <button
                key={`${option.source}:${option.sourceId}`}
                type="button"
                disabled={blocked}
                className="w-full rounded-md px-2 py-2 text-left hover:bg-muted disabled:opacity-60"
                onClick={() => {
                  onSelect(option);
                  setOpen(false);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{option.value}</span>
                  <span className="text-xs uppercase text-muted-foreground">{option.source.replace('_', ' ')}</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {[option.customerName, option.quoteTitle].filter(Boolean).join(' · ') || 'No title'}
                </p>
                {blocked ? (
                  <p className="mt-1 text-xs text-amber-600">{getJobCatalogueBlockMessage(option.blockReason)}</p>
                ) : option.siteAddress ? (
                  <p className="mt-1 text-xs text-muted-foreground">{option.siteAddress}</p>
                ) : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
