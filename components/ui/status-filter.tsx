'use client';

import { Button } from '@/components/ui/button';

interface StatusFilterProps<T extends string> {
  options: readonly T[];
  value: T;
  onChange: (value: T) => void;
  getLabel: (value: T) => string;
  className?: string;
}

export function StatusFilter<T extends string>({
  options,
  value,
  onChange,
  getLabel,
  className = '',
}: StatusFilterProps<T>) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {options.map((option) => (
        <Button
          key={option}
          variant="outline"
          size="sm"
          onClick={() => onChange(option)}
          className={value === option ? 'bg-white text-slate-900 border-white/80 hover:bg-slate-200' : 'border-slate-600 text-muted-foreground hover:bg-slate-700/50'}
        >
          {getLabel(option)}
        </Button>
      ))}
    </div>
  );
}

