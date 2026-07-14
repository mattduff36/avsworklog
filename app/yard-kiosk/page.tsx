import { AlertTriangle, LockKeyhole, PackageOpen, RefreshCw } from 'lucide-react';
import { redirect } from 'next/navigation';
import {
  getYardKioskBootstrap,
  requireInventoryKioskAccess,
} from '@/lib/server/inventory-kiosk';
import { YardKioskApp } from './components/YardKioskApp';

export const dynamic = 'force-dynamic';

export default async function YardKioskPage() {
  const access = await requireInventoryKioskAccess();
  if (!access.allowed && access.status === 401) {
    redirect('/login?redirect=%2Fyard-kiosk');
  }

  if (!access.allowed) {
    return (
      <KioskUnavailable
        title={access.status === 503 ? 'Yard kiosk unavailable' : 'Account not authorised'}
        message={access.error || 'The Yard kiosk cannot be opened with this account.'}
        configurationIssue={access.status === 503}
      />
    );
  }

  let bootstrap: Awaited<ReturnType<typeof getYardKioskBootstrap>> | null = null;
  try {
    bootstrap = await getYardKioskBootstrap(access);
  } catch (error) {
    console.error('Error rendering Yard kiosk:', error);
  }

  if (!bootstrap) {
    return (
      <KioskUnavailable
        title="Yard kiosk could not start"
        message="Live Inventory data could not be loaded. Check the connection and try again."
      />
    );
  }

  return <YardKioskApp bootstrap={bootstrap} />;
}

interface KioskUnavailableProps {
  title: string;
  message: string;
  configurationIssue?: boolean;
}

function KioskUnavailable({
  title,
  message,
  configurationIssue = false,
}: KioskUnavailableProps) {
  const Icon = configurationIssue ? AlertTriangle : LockKeyhole;
  return (
    <main className="fixed inset-0 z-[100] grid h-dvh w-screen place-items-center overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.12),_transparent_35%),linear-gradient(135deg,#020617,#0f172a)] p-8 text-white">
      <section className="w-full max-w-2xl rounded-[2rem] border border-white/10 bg-white/[0.06] p-10 text-center shadow-2xl shadow-black/30">
        <div className="mx-auto flex w-fit items-center gap-3 rounded-2xl bg-amber-300 px-4 py-3 text-slate-950">
          <PackageOpen className="h-7 w-7" />
          <span className="text-lg font-black">Yard Inventory</span>
        </div>
        <Icon className="mx-auto mt-8 h-16 w-16 text-amber-300" />
        <h1 className="mt-4 text-4xl font-black tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-xl text-lg leading-relaxed text-slate-300">{message}</p>
        {configurationIssue ? (
          <p className="mx-auto mt-3 max-w-xl text-sm text-slate-500">
            An administrator must create the dedicated login and populate
            <code className="mx-1 rounded bg-black/30 px-1.5 py-0.5 text-amber-200">inventory_kiosk_config</code>.
          </p>
        ) : null}
        <a
          href="/yard-kiosk"
          className="mx-auto mt-8 flex h-14 w-fit items-center justify-center gap-3 rounded-2xl bg-white px-7 text-lg font-black text-slate-950 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-amber-300"
        >
          <RefreshCw className="h-5 w-5" />
          Try again
        </a>
      </section>
    </main>
  );
}
