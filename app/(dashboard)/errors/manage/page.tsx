'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

/**
 * Redirect page from /errors/manage to /admin/errors/manage
 * Keeping this route for backward compatibility
 */
export default function ErrorsManageRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/admin/errors/manage');
  }, [router]);
  
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-red-500 mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to Error Reports Management...</p>
      </div>
    </div>
  );
}
