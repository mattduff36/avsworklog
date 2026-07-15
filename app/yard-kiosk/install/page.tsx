'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Chrome,
  Download,
  ExternalLink,
  Menu,
  MonitorSmartphone,
  PackageOpen,
  RotateCw,
  Wifi,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
}

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const navigatorWithStandalone = window.navigator as Navigator & {
    standalone?: boolean;
  };
  return (
    window.matchMedia('(display-mode: standalone)').matches
    || navigatorWithStandalone.standalone === true
  );
}

export default function YardKioskInstallPage() {
  const [installPrompt, setInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setIsStandalone(isStandaloneMode());

    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const handleInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
      setMessage('Yard Inventory has been installed.');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleInstalled);
    };
  }, []);

  async function installApp() {
    if (!installPrompt || installing) return;
    setInstalling(true);
    setMessage('');

    try {
      await installPrompt.prompt();
      const choice = await installPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setMessage('Installation started. Open Yard Inventory from the tablet home screen.');
        setInstallPrompt(null);
      } else {
        setMessage('Installation was cancelled. You can try again from the Chrome menu.');
      }
    } catch {
      setMessage('Use the Chrome menu steps below to install Yard Inventory.');
    } finally {
      setInstalling(false);
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-slate-950 px-5 py-8 text-white sm:px-8">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_10%,rgba(252,211,77,0.18),transparent_32%),radial-gradient(circle_at_88%_90%,rgba(14,165,233,0.09),transparent_28%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:42px_42px]" />

      <div className="relative mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-6xl flex-col justify-center">
        <header className="flex flex-col gap-4 border-b border-white/10 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-300 text-slate-950 shadow-lg shadow-amber-300/15">
              <PackageOpen className="h-8 w-8" />
            </div>
            <div>
              <p className="text-sm font-black uppercase tracking-[0.2em] text-amber-300">
                A&amp;V Squires
              </p>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
                Install Yard Inventory
              </h1>
            </div>
          </div>
          <Button asChild variant="outline" className="h-12 border-white/15 bg-white/5">
            <Link href="/yard-kiosk">
              Open kiosk
              <ExternalLink className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </header>

        <div className="grid gap-6 py-7 lg:grid-cols-[1.05fr_0.95fr]">
          <section className="rounded-[1.75rem] border border-amber-300/25 bg-slate-900/85 p-6 shadow-2xl shadow-black/25 backdrop-blur-xl sm:p-8">
            <div className="flex items-start gap-4">
              <div className="rounded-2xl bg-amber-300/10 p-3 text-amber-300">
                {isStandalone ? (
                  <CheckCircle2 className="h-8 w-8" />
                ) : (
                  <Download className="h-8 w-8" />
                )}
              </div>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-amber-300">
                  Dedicated tablet app
                </p>
                <h2 className="mt-2 text-2xl font-black">
                  {isStandalone ? 'Yard Inventory is installed' : 'Add it to the home screen'}
                </h2>
                <p className="mt-3 max-w-2xl leading-relaxed text-slate-300">
                  This separate app always launches the Yard kiosk, keeps the
                  full-screen workflow away from the main Squires app, and requests
                  landscape orientation on Android.
                </p>
              </div>
            </div>

            {installPrompt && !isStandalone ? (
              <Button
                type="button"
                onClick={() => void installApp()}
                disabled={installing}
                className="mt-7 h-14 w-full rounded-xl bg-amber-300 text-base font-black text-slate-950 hover:bg-amber-200 sm:w-auto sm:px-8"
              >
                <Download className="mr-2 h-5 w-5" />
                {installing ? 'Opening installer…' : 'Install Yard Inventory'}
              </Button>
            ) : null}

            {message ? (
              <p
                role="status"
                className="mt-5 rounded-xl border border-white/10 bg-white/5 p-4 text-sm text-slate-200"
              >
                {message}
              </p>
            ) : null}

            <div className="mt-7 grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <MonitorSmartphone className="h-5 w-5 text-amber-300" />
                <p className="mt-3 font-bold">Kiosk only</p>
                <p className="mt-1 text-sm text-slate-400">Opens Yard Inventory directly.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <RotateCw className="h-5 w-5 text-amber-300" />
                <p className="mt-3 font-bold">Landscape</p>
                <p className="mt-1 text-sm text-slate-400">Built for the wide tablet layout.</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <Wifi className="h-5 w-5 text-amber-300" />
                <p className="mt-3 font-bold">Online</p>
                <p className="mt-1 text-sm text-slate-400">A live connection is required.</p>
              </div>
            </div>
          </section>

          <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Chrome className="h-7 w-7 text-sky-300" />
              <div>
                <p className="text-sm font-black uppercase tracking-[0.18em] text-sky-300">
                  Android Chrome
                </p>
                <h2 className="text-xl font-black">Manual installation</h2>
              </div>
            </div>

            <ol className="mt-6 space-y-4">
              {[
                ['1', 'Open the Chrome menu', 'Tap the three-dot menu at the top right.'],
                ['2', 'Choose Add to Home screen', 'Then select Install app when Chrome asks.'],
                ['3', 'Confirm Yard Inventory', 'Use the separate Yard Inventory name shown by Android.'],
                ['4', 'Launch in landscape', 'Open it from the tablet home screen and keep rotation enabled.'],
              ].map(([step, title, detail]) => (
                <li key={step} className="flex gap-4">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-sky-300/35 bg-sky-300/10 font-black text-sky-200">
                    {step}
                  </span>
                  <div>
                    <p className="font-bold text-white">{title}</p>
                    <p className="mt-1 text-sm leading-relaxed text-slate-400">{detail}</p>
                  </div>
                </li>
              ))}
            </ol>

            <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">
              <Menu className="mt-0.5 h-4 w-4 shrink-0" />
              If the install button is not shown above, the Chrome menu method
              installs the same dedicated Yard Inventory app.
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
