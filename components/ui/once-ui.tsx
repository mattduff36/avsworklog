import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface OnceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}

export function OnceDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
}: OnceDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-w-md border-border bg-gradient-to-b from-slate-900 to-slate-950 text-white shadow-2xl',
          className
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-xl font-semibold tracking-tight text-white">{title}</DialogTitle>
          <DialogDescription className="text-slate-300">{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

