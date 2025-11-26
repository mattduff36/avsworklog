'use client';

import { WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function OfflineBanner() {
  const handleRefresh = () => {
    window.location.reload();
  };

  return (
    <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-400 mb-4">
      <WifiOff className="h-4 w-4" />
      <AlertDescription className="flex items-center justify-between gap-4">
        <div>
          <strong>You are offline.</strong> Data shown here might be out of date. New submissions will fail until connection returns.
        </div>
        <Button 
          size="sm" 
          variant="outline" 
          onClick={handleRefresh}
          className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20 hover:text-amber-300 flex-shrink-0"
        >
          Retry
        </Button>
      </AlertDescription>
    </Alert>
  );
}

