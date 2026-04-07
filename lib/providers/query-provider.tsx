'use client';

import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { handleAuthFailureStatus } from '@/lib/app-auth/recovery-bridge';
import { getErrorStatus, isAuthErrorStatus } from '@/lib/utils/http-error';

const ReactQueryDevtools = dynamic(
  () => import('@tanstack/react-query-devtools').then((mod) => ({ default: mod.ReactQueryDevtools })),
  { ssr: false }
);

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => {
      const handledQueryErrorCounts = new Map<string, number>();

      const queryCache = new QueryCache({
        onError: (error, query) => {
          const statusCode = getErrorStatus(error);
          if (!isAuthErrorStatus(statusCode)) {
            return;
          }

          const handledErrorCount = handledQueryErrorCounts.get(query.queryHash);
          const currentErrorCount = query.state.errorUpdateCount;
          if (handledErrorCount === currentErrorCount) {
            return;
          }

          handledQueryErrorCounts.set(query.queryHash, currentErrorCount);
          void handleAuthFailureStatus(statusCode).then((recovered) => {
            if (recovered) {
              void client.refetchQueries({
                queryKey: query.queryKey,
                exact: true,
                type: 'active',
              });
            }
          });
        },
      });

      const mutationCache = new MutationCache({
        onError: (error) => {
          const statusCode = getErrorStatus(error);
          if (!isAuthErrorStatus(statusCode)) {
            return;
          }

          void handleAuthFailureStatus(statusCode);
        },
      });

      const client = new QueryClient({
        queryCache,
        mutationCache,
        defaultOptions: {
          queries: {
            // With SSR, we usually want to set some default staleTime
            // above 0 to avoid refetching immediately on the client
            staleTime: 60 * 1000, // 1 minute
            gcTime: 5 * 60 * 1000, // 5 minutes (formerly cacheTime)
            refetchOnWindowFocus: false,
            refetchOnReconnect: false,
            retry: 1,
          },
          mutations: {
            retry: false,
          },
        },
      });

      return client;
    }
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      {process.env.NODE_ENV === 'development' ? <ReactQueryDevtools initialIsOpen={false} /> : null}
    </QueryClientProvider>
  );
}

