import { ModuleBetaBadge } from '@/components/ui/module-beta-badge';

export function DailyAllocationBetaBadge(props: {
  className?: string;
  tone?: 'brand' | 'onColor';
}) {
  return <ModuleBetaBadge {...props} accent="daily-allocation" />;
}
