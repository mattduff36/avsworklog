'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';

export default function VehiclesRedirect() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/fleet?tab=vehicles');
  }, [router]);
  
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500 mx-auto mb-4" />
        <p className="text-muted-foreground">Redirecting to Fleet Management...</p>
      </div>
    </div>
  );
}
