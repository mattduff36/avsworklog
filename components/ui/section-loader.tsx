'use client';

import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

interface SectionLoaderProps {
  message?: string;
  className?: string;
  iconClassName?: string;
}

export function SectionLoader({
  message = 'Loading...',
  className,
  iconClassName,
}: SectionLoaderProps) {
  return (
    <div
      className={cn('flex items-center justify-center rounded-lg border border-border py-12', className)}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 text-muted-foreground">
        <Loader2 className={cn('h-5 w-5 animate-spin text-avs-yellow', iconClassName)} />
        <span className="text-sm">{message}</span>
      </div>
    </div>
  );
}
