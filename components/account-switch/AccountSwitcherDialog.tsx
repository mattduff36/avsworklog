'use client';

import { useRouter } from 'next/navigation';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { isAccountSwitcherEnabled } from '@/lib/account-switch/feature-flag';
import { buildLockPathWithReturnTo } from '@/lib/account-switch/lock-state';

interface AccountSwitcherDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentProfileId: string | null;
}

export function AccountSwitcherDialog({
  open,
  onOpenChange,
  currentProfileId,
}: AccountSwitcherDialogProps) {
  const router = useRouter();

  if (!isAccountSwitcherEnabled() || !currentProfileId) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Switch Account</DialogTitle>
          <DialogDescription>
            Quick switching now uses the lock screen so every PIN unlock creates a fresh
            server-owned session.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onOpenChange(false);
              router.push(buildLockPathWithReturnTo('/dashboard'));
            }}
          >
            Open Lock Screen
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
