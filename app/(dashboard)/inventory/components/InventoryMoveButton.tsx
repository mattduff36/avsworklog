'use client';

import type { MouseEvent } from 'react';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface InventoryMoveButtonProps extends Omit<ButtonProps, 'children' | 'onClick'> {
  onMove: () => void;
  label?: string;
}

export function InventoryMoveButton({
  onMove,
  label = 'Move',
  className,
  ...props
}: InventoryMoveButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    onMove();
  }

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className={cn('border-slate-600', className)}
      onClick={handleClick}
      {...props}
    >
      {label}
    </Button>
  );
}
