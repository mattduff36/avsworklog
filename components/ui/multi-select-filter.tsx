'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface MultiSelectFilterOption<TValue extends string> {
  value: TValue;
  label: string;
  count?: number;
}

interface MultiSelectFilterProps<TValue extends string> {
  label: string;
  allLabel: string;
  selectedValues: TValue[];
  options: readonly MultiSelectFilterOption<TValue>[];
  onSelectedValuesChange: (values: TValue[]) => void;
  triggerClassName?: string;
}

function getMultiSelectTriggerLabel<TValue extends string>({
  allLabel,
  selectedValues,
  options,
}: {
  allLabel: string;
  selectedValues: TValue[];
  options: readonly MultiSelectFilterOption<TValue>[];
}) {
  if (selectedValues.length === 0) return allLabel;
  if (selectedValues.length === 1) {
    return options.find((option) => option.value === selectedValues[0])?.label || allLabel;
  }
  return `${selectedValues.length} selected`;
}

export function MultiSelectFilter<TValue extends string>({
  label,
  allLabel,
  selectedValues,
  options,
  onSelectedValuesChange,
  triggerClassName,
}: MultiSelectFilterProps<TValue>) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-filter-menu`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (!containerRef.current?.contains(target)) setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }

    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  function toggleValue(value: TValue) {
    if (selectedValues.includes(value)) {
      onSelectedValuesChange(selectedValues.filter((selectedValue) => selectedValue !== value));
      return;
    }

    onSelectedValuesChange([...selectedValues, value]);
  }

  return (
    <div ref={containerRef} className={cn('relative w-full sm:w-[150px]', triggerClassName)}>
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
        className="w-full justify-between border-slate-600 bg-slate-800 text-white hover:bg-slate-700"
      >
        <span className="truncate">
          {getMultiSelectTriggerLabel({ allLabel, selectedValues, options })}
        </span>
        <ChevronDown className={cn('ml-2 h-4 w-4 shrink-0 opacity-70 transition-transform', open && 'rotate-180')} />
      </Button>

      {open ? (
        <div
          id={panelId}
          className="absolute left-0 top-full z-40 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-slate-700 bg-slate-950 p-1 text-sm text-slate-200 shadow-xl"
        >
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <label className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left hover:bg-slate-800">
            <input
              type="checkbox"
              checked={selectedValues.length === 0}
              onChange={() => onSelectedValuesChange([])}
              className="h-4 w-4 accent-avs-yellow"
            />
            <span>{allLabel}</span>
          </label>
          {options.map((option) => (
            <label
              key={option.value}
              className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-3 py-2 text-left hover:bg-slate-800"
            >
              <input
                type="checkbox"
                checked={selectedValues.includes(option.value)}
                onChange={() => toggleValue(option.value)}
                className="h-4 w-4 accent-avs-yellow"
              />
              <span className="min-w-0 flex-1 truncate">{option.label}</span>
              {typeof option.count === 'number' && option.count > 0 ? (
                <span className="text-xs text-slate-400">({option.count})</span>
              ) : null}
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}
