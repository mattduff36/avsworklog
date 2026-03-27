'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { PageLoader } from '@/components/ui/page-loader';

export default function VehiclesRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/fleet?tab=vans');
  }, [router]);
  
  return (
    <PageLoader message="Redirecting to Fleet Management..." />
  );
}
