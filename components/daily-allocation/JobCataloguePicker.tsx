'use client';

import { useMemo, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { JobCodePicker } from '@/components/timesheets/JobCodeFields';
import { useJobCatalogueOptions } from '@/lib/client/job-catalogue';
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
  variant?: 'catalogue' | 'timesheet-modal';
  onSelect: (option: JobCatalogueOption | null) => void;
}

export function JobCataloguePicker({
  value,
  sourceId,
  disabled,
  id,
  className,
  variant = 'catalogue',
  onSelect,
}: JobCataloguePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const { options, isLoading, error, retry } = useJobCatalogueOptions();

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

  const timesheetOptions = useMemo(() => {
    const seen = new Set<string>();

    return options.flatMap((option) => {
      if (option.blockReason || seen.has(option.value)) return [];
      seen.add(option.value);
      return [{
        value: option.value,
        label: option.label,
        customerName: option.customerName,
        quoteTitle: option.quoteTitle,
        source: option.source,
      }];
    });
  }, [options]);

  if (variant === 'timesheet-modal') {
    return (
      <JobCodePicker
        id={id}
        value={value || ''}
        disabled={disabled}
        inputClassName={cn('uppercase', className)}
        jobCodeOptions={timesheetOptions}
        jobCodeOptionsLoading={isLoading}
        jobCodeOptionsError={error}
        onRetryJobCodeOptions={retry}
        showOptionDetails={false}
        onChange={(nextValue) => {
          const option = options.find((candidate) => (
            !candidate.blockReason && candidate.value === nextValue
          ));
          onSelect(option || null);
        }}
      />
    );
  }

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
          {isLoading ? <p className="px-2 py-3 text-sm text-muted-foreground">Loading job codes…</p> : null}
          {!isLoading && error ? (
            <div className="space-y-2 rounded-md border border-destructive/40 p-3" role="alert">
              <p className="text-sm text-destructive">{error}</p>
              <Button type="button" variant="outline" size="sm" onClick={retry}>
                Retry
              </Button>
            </div>
          ) : null}
          {!isLoading && !error && filtered.length === 0 ? (
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
