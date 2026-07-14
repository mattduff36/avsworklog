'use client';

import { useCallback, useState } from 'react';
import { Loader2, LogOut, Menu, PackageOpen } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from '@/components/ui/popover';
import { usePressHold } from '@/lib/hooks/usePressHold';
import { useAuth } from '@/lib/hooks/useAuth';

export const YARD_KIOSK_ADMIN_HOLD_DURATION_MS = 3_000;

interface YardKioskAdminMenuProps {
  disabled?: boolean;
}

export function YardKioskAdminMenu({ disabled = false }: YardKioskAdminMenuProps) {
  const { signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  const revealMenu = useCallback(() => {
    setMenuOpen(true);
  }, []);
  const { holding, handlers } = usePressHold({
    durationMs: YARD_KIOSK_ADMIN_HOLD_DURATION_MS,
    disabled: disabled || menuOpen || confirmOpen,
    onComplete: revealMenu,
  });

  function requestSignOut() {
    setMenuOpen(false);
    setSignOutError('');
    setConfirmOpen(true);
  }

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');

    try {
      const { error } = await signOut();
      if (error) {
        setSignOutError(error.message || 'The kiosk could not sign out. Please try again.');
        setSigningOut(false);
      }
    } catch (error) {
      setSignOutError(
        error instanceof Error ? error.message : 'The kiosk could not sign out. Please try again.',
      );
      setSigningOut(false);
    }
  }

  return (
    <>
      <Popover
        open={menuOpen}
        onOpenChange={(open) => {
          if (!open) setMenuOpen(false);
        }}
      >
        <PopoverAnchor asChild>
          <button
            type="button"
            aria-label={menuOpen
              ? 'Close Yard Inventory admin menu'
              : 'Yard Inventory logo. Press and hold for 3 seconds to open the admin menu'}
            aria-expanded={menuOpen}
            disabled={disabled}
            onClick={(event) => event.preventDefault()}
            onContextMenu={(event) => event.preventDefault()}
            {...handlers}
            className={[
              'relative grid h-12 w-12 shrink-0 select-none place-items-center overflow-hidden rounded-2xl bg-amber-300 text-slate-950',
              'touch-none transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-100 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950',
              holding ? 'scale-95 ring-4 ring-amber-100/50' : '',
              disabled ? 'cursor-not-allowed opacity-50' : '',
            ].join(' ')}
          >
            {menuOpen ? <Menu className="h-7 w-7" /> : <PackageOpen className="h-7 w-7" />}
            {holding ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-1 bottom-1 h-1 overflow-hidden rounded-full bg-slate-950/20"
              >
                <span className="block h-full w-full animate-pulse rounded-full bg-slate-950" />
              </span>
            ) : null}
          </button>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={10}
          role="menu"
          className="w-72 rounded-2xl border-white/10 bg-slate-950/95 p-3 text-white shadow-2xl shadow-black/40 backdrop-blur-xl"
        >
          <div className="px-2 pb-2 pt-1">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-300">
              Kiosk admin
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            role="menuitem"
            onClick={requestSignOut}
            className="h-14 w-full justify-start rounded-xl px-4 text-base font-bold text-red-200 hover:bg-red-500/15 hover:text-red-100"
          >
            <LogOut className="mr-3 h-5 w-5" />
            Log out
          </Button>
        </PopoverContent>
      </Popover>

      <span className="sr-only" aria-live="polite">
        {holding ? 'Keep holding to open the kiosk admin menu' : ''}
      </span>

      <AlertDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!signingOut) setConfirmOpen(open);
        }}
      >
        <AlertDialogContent className="border border-white/10 bg-slate-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>Log out of Yard Inventory?</AlertDialogTitle>
            <AlertDialogDescription>
              This ends the kiosk session and returns this device to the sign-in page.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {signOutError ? (
            <p role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-100">
              {signOutError}
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>Keep kiosk open</AlertDialogCancel>
            <AlertDialogAction
              disabled={signingOut}
              onClick={(event) => {
                event.preventDefault();
                void handleSignOut();
              }}
              className="bg-red-600 text-white hover:bg-red-500"
            >
              {signingOut ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LogOut className="mr-2 h-4 w-4" />}
              {signingOut ? 'Logging out…' : 'Log out'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
