import * as React from 'react';
import {
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { Button, type ButtonProps } from '@/components/ui/button';
import {
  SelectContent,
  SelectItem,
  SelectTrigger,
} from '@/components/ui/select';
import { useTabletMode } from '@/components/layout/tablet-mode-context';
import { cn } from '@/lib/utils/cn';

export const TABLET_TOUCH_BUTTON_CLASS =
  'min-h-11 text-base px-4 [&_svg]:size-5';
export const TABLET_TOUCH_ICON_BUTTON_CLASS =
  'h-11 w-11 [&_svg]:size-5';
export const TABLET_TOUCH_SELECT_TRIGGER_CLASS =
  'min-h-11 text-base px-3.5';
export const TABLET_TOUCH_SELECT_CONTENT_CLASS =
  'max-h-[420px]';
export const TABLET_TOUCH_SELECT_ITEM_CLASS =
  'min-h-11 py-2.5 text-base';
export const TABLET_TOUCH_DROPDOWN_CONTENT_CLASS =
  'min-w-[12rem]';
export const TABLET_TOUCH_DROPDOWN_ITEM_CLASS =
  'min-h-11 py-2.5 text-base';

export function TabletAwareButton({ className, size, ...props }: ButtonProps) {
  const { tabletModeEnabled } = useTabletMode();

  const touchClass =
    size === 'icon' ? TABLET_TOUCH_ICON_BUTTON_CLASS : TABLET_TOUCH_BUTTON_CLASS;

  return (
    <Button
      size={size}
      className={cn(tabletModeEnabled && touchClass, className)}
      {...props}
    />
  );
}

export const TabletAwareSelectTrigger = React.forwardRef<
  React.ElementRef<typeof SelectTrigger>,
  React.ComponentPropsWithoutRef<typeof SelectTrigger>
>(({ className, ...props }, ref) => {
  const { tabletModeEnabled } = useTabletMode();

  return (
    <SelectTrigger
      ref={ref}
      className={cn(tabletModeEnabled && TABLET_TOUCH_SELECT_TRIGGER_CLASS, className)}
      {...props}
    />
  );
});
TabletAwareSelectTrigger.displayName = 'TabletAwareSelectTrigger';

export const TabletAwareSelectContent = React.forwardRef<
  React.ElementRef<typeof SelectContent>,
  React.ComponentPropsWithoutRef<typeof SelectContent>
>(({ className, ...props }, ref) => {
  const { tabletModeEnabled } = useTabletMode();

  return (
    <SelectContent
      ref={ref}
      className={cn(tabletModeEnabled && TABLET_TOUCH_SELECT_CONTENT_CLASS, className)}
      {...props}
    />
  );
});
TabletAwareSelectContent.displayName = 'TabletAwareSelectContent';

export const TabletAwareSelectItem = React.forwardRef<
  React.ElementRef<typeof SelectItem>,
  React.ComponentPropsWithoutRef<typeof SelectItem>
>(({ className, ...props }, ref) => {
  const { tabletModeEnabled } = useTabletMode();

  return (
    <SelectItem
      ref={ref}
      className={cn(tabletModeEnabled && TABLET_TOUCH_SELECT_ITEM_CLASS, className)}
      {...props}
    />
  );
});
TabletAwareSelectItem.displayName = 'TabletAwareSelectItem';

export const TabletAwareDropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuContent>
>(({ className, ...props }, ref) => {
  const { tabletModeEnabled } = useTabletMode();

  return (
    <DropdownMenuContent
      ref={ref}
      className={cn(tabletModeEnabled && TABLET_TOUCH_DROPDOWN_CONTENT_CLASS, className)}
      {...props}
    />
  );
});
TabletAwareDropdownMenuContent.displayName = 'TabletAwareDropdownMenuContent';

export const TabletAwareDropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuItem>
>(({ className, ...props }, ref) => {
  const { tabletModeEnabled } = useTabletMode();

  return (
    <DropdownMenuItem
      ref={ref}
      className={cn(tabletModeEnabled && TABLET_TOUCH_DROPDOWN_ITEM_CLASS, className)}
      {...props}
    />
  );
});
TabletAwareDropdownMenuItem.displayName = 'TabletAwareDropdownMenuItem';
