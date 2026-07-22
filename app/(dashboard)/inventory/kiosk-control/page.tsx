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
    <div className="min-h-screen bg-slate-950 px-4 py-5 sm:px-6 lg:px-8">
      <YardKioskController />
    </div>
  );
}
