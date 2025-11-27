'use client';

import { AlertCircle } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

interface ErrorMessageProps {
  error: string;
  onRetry?: () => void;
  title?: string;
  variant?: 'default' | 'destructive';
}

export function ErrorMessage({ 
  error, 
  onRetry, 
  title = 'Error',
  variant = 'destructive' 
}: ErrorMessageProps) {
  return (
    <Alert variant={variant} className="flex items-start justify-between">
      <div className="flex items-start gap-3 flex-1">
        <AlertCircle className="h-4 w-4 mt-0.5" />
        <div className="flex-1">
          <AlertTitle>{title}</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </div>
      </div>
      {onRetry && (
        <Button 
          size="sm" 
          variant="outline" 
          onClick={onRetry}
          className="ml-4 shrink-0"
        >
          Retry
        </Button>
      )}
    </Alert>
  );
}

interface ErrorPageProps {
  error: string;
  title?: string;
  onRetry?: () => void;
  backHref?: string;
  backLabel?: string;
}

export function ErrorPage({ 
  error, 
  title = 'Something went wrong',
  onRetry,
  backHref,
  backLabel = 'Go Back'
}: ErrorPageProps) {
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="max-w-md w-full space-y-4">
        <ErrorMessage error={error} title={title} onRetry={onRetry} />
        {backHref && (
          <Button variant="ghost" asChild className="w-full">
            <a href={backHref}>{backLabel}</a>
          </Button>
        )}
      </div>
    </div>
  );
}

