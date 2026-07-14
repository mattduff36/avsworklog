'use client';

import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LegacyQuoteLocationOptInProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  className?: string;
  size?: 'sm' | 'default';
}

export function LegacyQuoteLocationOptIn({
  enabled,
  onEnabledChange,
  className,
  size = 'sm',
}: LegacyQuoteLocationOptInProps) {
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      aria-pressed={enabled}
      onClick={() => onEnabledChange(!enabled)}
      className={cn(
        'border-slate-600',
        enabled && 'border-amber-400/50 bg-amber-400/10 text-amber-100 hover:bg-amber-400/15',
        className,
      )}
    >
      <History className="mr-2 h-4 w-4" />
      {enabled ? 'Legacy quotes included' : 'Include legacy quotes'}
    </Button>
  );
}
