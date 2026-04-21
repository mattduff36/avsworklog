'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils/cn';
import { Plus, X } from 'lucide-react';

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
}: JobCodeFieldsProps) {
  const displayValues = values.length > 0 ? values : [''];

  return (
    <div className={cn('space-y-2', containerClassName)}>
      <div className="relative">
        <Input
          value={displayValues[0] || ''}
          onChange={(event) => onChange(0, event.target.value)}
          placeholder={placeholder}
          maxLength={7}
          disabled={disabled}
          className={cn(disabled ? '' : 'pr-11', inputClassName)}
        />
        {!disabled && (
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
      </div>

      {displayValues.slice(1).map((value, index) => {
        const actualIndex = index + 1;
        return (
          <div key={actualIndex} className={cn('flex items-center gap-2', rowsClassName)}>
            <Input
              value={value}
              onChange={(event) => onChange(actualIndex, event.target.value)}
              placeholder={placeholder}
              maxLength={7}
              disabled={disabled}
              className={cn('flex-1', extraInputClassName || inputClassName)}
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
