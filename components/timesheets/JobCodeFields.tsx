'use client';

import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils/cn';
import {
  JOB_NUMBER_MAX_LENGTH,
  QUOTE_JOB_NUMBER_REGEX,
  normalizeJobNumberInput,
} from '@/lib/utils/timesheet-job-codes';
import type { TimesheetJobCodeOption } from '@/lib/client/timesheet-job-codes';
import { Check, Plus, X } from 'lucide-react';

interface JobCodeFieldsProps {
  values: string[];
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  disabled?: boolean;
  placeholder?: string;
  inputClassName?: string;
  extraInputClassName?: string;
  containerClassName?: string;
  rowsClassName?: string;
  jobCodeOptions?: TimesheetJobCodeOption[];
  jobCodeOptionsLoading?: boolean;
}

interface JobCodeFieldRowProps {
  index: number;
  value: string;
  onChange: (index: number, value: string) => void;
  disabled: boolean;
  placeholder?: string;
  inputClassName?: string;
  jobCodeOptions: TimesheetJobCodeOption[];
  jobCodeOptionsLoading: boolean;
  trailingControl?: ReactNode;
}

const LEGACY_JOB_NUMBER_REGEX = /^\d{4}-[A-Z]{2}$/;

function JobCodeFieldRow({
  index,
  value,
  onChange,
  disabled,
  placeholder,
  inputClassName,
  jobCodeOptions,
  jobCodeOptionsLoading,
  trailingControl,
}: JobCodeFieldRowProps) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const normalizedValue = normalizeJobNumberInput(value || '');
  const manualInputValue = QUOTE_JOB_NUMBER_REGEX.test(normalizedValue) ? '' : normalizedValue;
  const buttonLabel = normalizedValue || 'Select';

  if (disabled) {
    return (
      <div className="relative flex-1">
        <Input
          value={value || ''}
          onChange={(event) => onChange(index, event.target.value)}
          placeholder={placeholder}
          maxLength={JOB_NUMBER_MAX_LENGTH}
          disabled={disabled}
          className={cn(trailingControl && !disabled ? 'pr-11' : '', inputClassName)}
        />
        {trailingControl}
      </div>
    );
  }

  return (
    <div className="relative flex-1">
      <button
        type="button"
        disabled={disabled}
        aria-label={normalizedValue ? `Selected job code ${normalizedValue}` : 'Select job code'}
        onClick={() => setIsPickerOpen(true)}
        className={cn(
          'flex h-9 w-full items-center justify-center rounded-md border border-input bg-transparent px-3 py-2 text-center text-sm shadow-sm ring-offset-background transition-colors focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
          trailingControl ? 'pr-11' : '',
          normalizedValue ? 'text-foreground' : 'text-muted-foreground',
          inputClassName
        )}
      >
        <span className="min-w-0 flex-1 truncate">{buttonLabel}</span>
      </button>

      <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
        <DialogContent
          hideCloseButton
          className="w-[calc(100vw-2rem)] max-w-sm gap-3 rounded-xl border border-slate-700 bg-slate-950 p-4 text-white"
        >
          <DialogTitle className="sr-only">Choose job code</DialogTitle>
          <div className="max-h-[70vh] space-y-2 overflow-y-auto pt-2">
            <Input
              value={manualInputValue}
              onChange={(event) => {
                const nextValue = event.target.value;
                onChange(index, nextValue);
                if (LEGACY_JOB_NUMBER_REGEX.test(normalizeJobNumberInput(nextValue))) {
                  setIsPickerOpen(false);
                }
              }}
              placeholder="Enter 4 digit code"
              maxLength={JOB_NUMBER_MAX_LENGTH}
              className="min-h-12 rounded-lg border-slate-700 bg-slate-900 px-4 py-3 text-center font-mono text-lg text-white placeholder:text-slate-400"
            />
            {jobCodeOptionsLoading ? (
              <p className="px-2 py-3 text-center text-sm text-slate-300">Loading job codes...</p>
            ) : jobCodeOptions.length > 0 ? (
              jobCodeOptions.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className="flex min-h-12 w-full items-center justify-between gap-3 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-left font-mono text-lg text-white hover:bg-slate-800"
                  onClick={() => {
                    onChange(index, option.value);
                    setIsPickerOpen(false);
                  }}
                >
                  <span className="truncate">{option.label}</span>
                  {normalizedValue === option.value && <Check className="h-5 w-5 shrink-0" />}
                </button>
              ))
            ) : (
              <p className="px-2 py-3 text-center text-sm text-slate-300">No active 5 digit job codes found.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
      {trailingControl}
    </div>
  );
}

export function JobCodeFields({
  values,
  onChange,
  onAdd,
  onRemove,
  disabled = false,
  placeholder,
  inputClassName,
  extraInputClassName,
  containerClassName,
  rowsClassName,
  jobCodeOptions = [],
  jobCodeOptionsLoading = false,
}: JobCodeFieldsProps) {
  const displayValues = values.length > 0 ? values : [''];

  return (
    <div className={cn('space-y-2', containerClassName)}>
      <div className="relative flex">
        <JobCodeFieldRow
          index={0}
          value={displayValues[0] || ''}
          onChange={onChange}
          placeholder={placeholder}
          disabled={disabled}
          inputClassName={inputClassName}
          jobCodeOptions={jobCodeOptions}
          jobCodeOptionsLoading={jobCodeOptionsLoading}
          trailingControl={!disabled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onAdd}
              className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2 rounded-md text-muted-foreground hover:text-foreground"
              aria-label="Add another job code"
            >
              <Plus className="h-4 w-4" />
            </Button>
          )}
        />
      </div>

      {displayValues.slice(1).map((value, index) => {
        const actualIndex = index + 1;
        return (
          <div key={actualIndex} className={cn('flex items-center gap-2', rowsClassName)}>
            <JobCodeFieldRow
              index={actualIndex}
              value={value}
              onChange={onChange}
              placeholder={placeholder}
              disabled={disabled}
              inputClassName={cn('flex-1', extraInputClassName || inputClassName)}
              jobCodeOptions={jobCodeOptions}
              jobCodeOptionsLoading={jobCodeOptionsLoading}
            />
            {!disabled && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemove(actualIndex)}
                className="h-8 w-8 shrink-0 rounded-md text-muted-foreground hover:text-destructive"
                aria-label={`Remove job code ${actualIndex + 1}`}
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
