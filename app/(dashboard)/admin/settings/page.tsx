'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { SlidersHorizontal } from 'lucide-react';
import { PageLoader } from '@/components/ui/page-loader';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { TimesheetTypeExceptionsCard } from './components/TimesheetTypeExceptionsCard';

export default function AdminSettingsPage() {
  const router = useRouter();
  const { isAdmin, isSuperAdmin, isActualSuperAdmin } = useAuth();
  const { hasPermission: canAccessSettings, loading: permissionLoading } = usePermissionCheck('admin-settings', false);
  const isAdminActor = isAdmin || isSuperAdmin || isActualSuperAdmin;

  useEffect(() => {
    if (!permissionLoading && (!canAccessSettings || !isAdminActor)) {
      router.push('/dashboard');
    }
  }, [canAccessSettings, isAdminActor, permissionLoading, router]);

  if (permissionLoading) {
    return <PageLoader message="Loading admin settings..." />;
  }

  if (!canAccessSettings || !isAdminActor) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="bg-slate-900 rounded-lg p-6 border border-border">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-avs-yellow/20 rounded-lg">
            <SlidersHorizontal className="h-6 w-6 text-avs-yellow" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white mb-2">Admin Settings</h1>
            <p className="text-muted-foreground">
              Configure admin-only tools, overrides, and system-level controls.
            </p>
          </div>
        </div>
      </div>

      <TimesheetTypeExceptionsCard />
    </div>
  );
}
