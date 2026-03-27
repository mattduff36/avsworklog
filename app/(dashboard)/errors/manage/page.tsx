'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui/page-loader';

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
    <PageLoader message="Redirecting to Error Reports Management..." />
  );
}
