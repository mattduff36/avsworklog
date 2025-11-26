import { WifiOff } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

export function OfflineBanner() {
  return (
    <Alert className="bg-amber-500/10 border-amber-500/30 text-amber-400 mb-4">
      <WifiOff className="h-4 w-4" />
      <AlertDescription>
        <strong>You are offline.</strong> Data shown here might be out of date. New submissions will fail until connection returns.
      </AlertDescription>
    </Alert>
  );
}

