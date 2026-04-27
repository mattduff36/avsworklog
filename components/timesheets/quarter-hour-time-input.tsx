'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils/cn';
import {
  QUARTER_HOUR_MINUTES,
  getQuarterHourHours,
  getQuarterHourMinutesForHour,
  isQuarterHourTimeAllowed,
  normalizeQuarterHourTime,
} from '@/lib/utils/quarter-hour-time';

interface QuarterHourTimeInputProps {
  id?: string;
  value?: string | null;
  onChange: (value: string) => void;
  disabled?: boolean;
  min?: string | null;
  max?: string | null;
  className?: string;
  controlClassName?: string;
  minuteButtonClassName?: string;
  ariaLabel?: string;
}

export function QuarterHourTimeInput({
  id,
  value,
  onChange,
  disabled = false,
  min,
  max,
  className,
  controlClassName,
  minuteButtonClassName,
  ariaLabel = 'Time',
}: QuarterHourTimeInputProps) {
  const normalizedValue = normalizeQuarterHourTime(value);
  const valueHour = normalizedValue.slice(0, 2);
  const valueMinute = normalizedValue.slice(3, 5);
  const hourOptions = getQuarterHourHours(min, max);
  const selectedHour = hourOptions.includes(valueHour) ? valueHour : '';
  const minuteOptions = selectedHour
    ? getQuarterHourMinutesForHour(selectedHour, min, max)
    : [...QUARTER_HOUR_MINUTES];

  function commitTime(hour: string, minute: string) {
    const nextValue = `${hour}:${minute}`;
    if (!isQuarterHourTimeAllowed(nextValue, min, max)) return;
    onChange(nextValue);
  }

  function handleHourChange(hour: string) {
    const allowedMinutes = getQuarterHourMinutesForHour(hour, min, max);
    const nextMinute = allowedMinutes.includes(valueMinute) ? valueMinute : allowedMinutes[0];
    if (!nextMinute) return;
    commitTime(hour, nextMinute);
  }

  function handleMinuteChange(minute: string) {
    const nextHour = selectedHour || hourOptions[0];
    if (!nextHour) return;

    const allowedMinutes = getQuarterHourMinutesForHour(nextHour, min, max);
    const nextMinute = allowedMinutes.includes(minute) ? minute : allowedMinutes[0];
    if (!nextMinute) return;
    commitTime(nextHour, nextMinute);
  }

  return (
    <div className={cn('space-y-2', className)} id={id}>
      <div className="flex items-center gap-1">
        <Select
          value={selectedHour || undefined}
          onValueChange={handleHourChange}
          disabled={disabled || hourOptions.length === 0}
        >
          <SelectTrigger
            aria-label={`${ariaLabel} hour`}
            className={cn('h-9 min-w-0 flex-1 bg-background', controlClassName)}
          >
            <SelectValue placeholder="Hour" />
          </SelectTrigger>
          <SelectContent>
            {hourOptions.map((hour) => (
              <SelectItem key={hour} value={hour}>
                {hour}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {normalizedValue ? (
          <button
            type="button"
            aria-label={`Clear ${ariaLabel.toLowerCase()}`}
            onClick={() => onChange('')}
            disabled={disabled}
            className={cn(
              'h-9 rounded-md border border-input px-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-50',
              controlClassName
            )}
          >
            X
          </button>
        ) : null}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {QUARTER_HOUR_MINUTES.map((minute) => {
          const isSelected = selectedHour && valueMinute === minute;
          const isAllowed = selectedHour
            ? minuteOptions.includes(minute)
            : hourOptions.some((hour) => getQuarterHourMinutesForHour(hour, min, max).includes(minute));

          return (
            <button
              key={minute}
              type="button"
              aria-label={`${ariaLabel} minutes ${minute}`}
              aria-pressed={Boolean(isSelected)}
              onClick={() => handleMinuteChange(minute)}
              disabled={disabled || !isAllowed}
              className={cn(
                'h-8 rounded-md border border-input bg-background px-1 text-sm font-semibold tabular-nums transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40',
                minuteButtonClassName,
                isSelected && 'border-primary bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground'
              )}
            >
              {minute}
            </button>
          );
        })}
      </div>
    </div>
  );
}
