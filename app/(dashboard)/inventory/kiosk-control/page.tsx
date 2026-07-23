import { redirect } from 'next/navigation';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import { YardKioskController } from './YardKioskController';

export const dynamic = 'force-dynamic';

export default async function InventoryKioskControlPage() {
  const access = await requireInventoryManagerAccess();
  if (!access.allowed) {
    redirect(access.status === 401 ? '/login' : '/inventory');
  }

  return (
    <div className="inventory-mobile-ui min-h-dvh min-w-0 bg-slate-950 px-2 py-3 sm:px-6 sm:py-5 lg:px-8">
      <YardKioskController />
    </div>
  );
}
