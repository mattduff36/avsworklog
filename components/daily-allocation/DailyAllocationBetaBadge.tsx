import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

export function DailyAllocationBetaBadge({
  className,
  tone = 'brand',
}: {
  className?: string;
  tone?: 'brand' | 'onColor';
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'w-fit px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.16em] print:hidden',
        tone === 'onColor'
          ? 'border-white/30 bg-white/10 text-white'
          : 'border-daily-allocation/30 bg-daily-allocation-soft text-daily-allocation',
        className,
      )}
    >
      Beta
    </Badge>
  );
}
