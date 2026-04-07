'use client';

import { useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface ServiceUnavailableStateProps {
  title?: string;
  description?: string;
  retryLabel?: string;
  onRetry?: () => Promise<void> | void;
}

export function ServiceUnavailableState({
  title = 'Service temporarily unavailable',
  description = 'Loading has been paused to avoid repeated requests while the backend recovers.',
  retryLabel = 'Retry',
  onRetry,
}: ServiceUnavailableStateProps) {
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    if (!onRetry || retrying) {
      return;
    }

    setRetrying(true);
    try {
      await onRetry();
    } finally {
      setRetrying(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[400px] w-full max-w-3xl items-center justify-center">
      <Card className="w-full border-amber-500/30 bg-slate-950/80">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-amber-200">
            <AlertTriangle className="h-5 w-5" />
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-300">{description}</p>
          {onRetry ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void handleRetry();
              }}
              disabled={retrying}
              className="border-amber-500/40 text-amber-100 hover:bg-amber-500/10"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${retrying ? 'animate-spin' : ''}`} />
              {retrying ? 'Retrying...' : retryLabel}
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
