import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils/cn';

interface ServiceTypeBadgeProps {
  typeLabel: string | null;
  needsChoosing?: boolean;
}

function getServiceTypeDotClass(typeLabel: string, needsChoosing: boolean): string {
  if (needsChoosing) return 'bg-[#ffd400]';
  if (/full/i.test(typeLabel)) return 'bg-[#c77dff]';
  if (/basic\s*a/i.test(typeLabel)) return 'bg-[#00ffcc]';
  if (/basic\s*b/i.test(typeLabel)) return 'bg-[#3399ff]';
  return 'bg-[#f8fafc]';
}

export function ServiceTypeBadge({
  typeLabel,
  needsChoosing = false,
}: ServiceTypeBadgeProps) {
  const label = needsChoosing ? 'Next service type needs choosing' : typeLabel;
  if (!label) return null;

  return (
    <Badge
      variant="outline"
      className="max-w-full gap-[4px] whitespace-normal rounded-none border-[#64748b] bg-[#1e293b] px-[6px] py-0 text-[10px] font-semibold leading-[16px] text-[#f1f5f9]"
    >
      <span
        aria-hidden="true"
        className={cn(
          'h-[6px] w-[6px] shrink-0 rounded-full',
          getServiceTypeDotClass(label, needsChoosing),
        )}
      />
      {label}
    </Badge>
  );
}
