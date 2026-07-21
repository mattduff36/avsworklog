import { Badge, type BadgeProps } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { InventoryLocation } from '../types';
import {
  formatInventoryLocationTypeLabel,
  getInventoryLocationTypePresentation,
} from '../utils';

interface InventoryLocationTypeBadgeProps extends Omit<BadgeProps, 'children' | 'variant'> {
  location: Pick<InventoryLocation, 'location_type'>;
}

export function InventoryLocationTypeBadge({
  location,
  className,
  ...props
}: InventoryLocationTypeBadgeProps) {
  const presentation = getInventoryLocationTypePresentation(location);

  return (
    <Badge
      variant="outline"
      data-location-type={location.location_type}
      className={cn(presentation.badgeClassName, className)}
      {...props}
    >
      {formatInventoryLocationTypeLabel(location)}
    </Badge>
  );
}
