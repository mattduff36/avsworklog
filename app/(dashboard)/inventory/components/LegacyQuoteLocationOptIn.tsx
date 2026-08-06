'use client';

import { History } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LegacyQuoteLocationOptInProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  className?: string;
  size?: 'sm' | 'default';
  label?: string;
}

export function LegacyQuoteLocationOptIn({
  enabled,
  onEnabledChange,
  className,
  size = 'sm',
  label,
}: LegacyQuoteLocationOptInProps) {
  return (
    <Button
      type="button"
      size={size}
      variant="outline"
      aria-pressed={enabled}
      onClick={() => onEnabledChange(!enabled)}
      className={cn(
        'border-slate-600/40 bg-slate-800/30 text-slate-400 shadow-none hover:bg-slate-800/50 hover:text-slate-300',
        enabled && 'border-slate-500/50 bg-slate-700/40 text-slate-200 hover:bg-slate-700/50 hover:text-slate-100',
        className,
      )}
      data-testid="legacy-quote-location-opt-in"
    >
      <History className="mr-2 h-4 w-4 opacity-70" />
      {label ?? (enabled ? 'Legacy locations included' : 'Include legacy locations')}
    </Button>
  );
}
