'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { toast } from 'sonner';

export type DemoWriteState = 'loading' | 'enabled' | 'readonly' | 'error';

interface DemoConfigResponse {
  readonly?: boolean;
}

interface DemoMutationContextValue {
  writeState: DemoWriteState;
  canMutate: boolean;
  refreshConfig: () => Promise<void>;
  runMutation: <Result>(
    operationName: string,
    operation: () => Promise<Result>
  ) => Promise<Result | undefined>;
  mutationFetch: <Result>(input: RequestInfo | URL, init: RequestInit) => Promise<Result | undefined>;
}

interface DemoMutationProviderProps {
  children: ReactNode;
}

const DemoMutationContext = createContext<DemoMutationContextValue | null>(null);

function emitMutationTelemetry(
  operation: string,
  outcome: 'blocked' | 'success' | 'failure'
) {
  const detail = { origin: 'demo-ui-v2', operation, outcome };
  window.dispatchEvent(new CustomEvent('demo-ui:mutation', { detail }));
  console.info('[demo-ui:mutation]', detail);
}

export function DemoMutationProvider({ children }: DemoMutationProviderProps) {
  const [writeState, setWriteState] = useState<DemoWriteState>('loading');

  const refreshConfig = useCallback(async () => {
    setWriteState('loading');
    try {
      const response = await fetch('/api/demo-ui/config', { cache: 'no-store' });
      const payload = (await response.json()) as DemoConfigResponse;
      if (!response.ok || typeof payload.readonly !== 'boolean') {
        throw new Error('Invalid demo configuration');
      }
      setWriteState(payload.readonly ? 'readonly' : 'enabled');
    } catch {
      setWriteState('error');
    }
  }, []);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  const runMutation = useCallback(
    async <Result,>(
      operationName: string,
      operation: () => Promise<Result>
    ): Promise<Result | undefined> => {
      if (writeState !== 'enabled') {
        emitMutationTelemetry(operationName, 'blocked');
        toast.error('Demo is read-only. No changes were made.');
        return undefined;
      }

      try {
        const result = await operation();
        emitMutationTelemetry(operationName, 'success');
        return result;
      } catch (error) {
        emitMutationTelemetry(operationName, 'failure');
        throw error;
      }
    },
    [writeState]
  );

  const mutationFetch = useCallback(
    async <Result,>(input: RequestInfo | URL, init: RequestInit): Promise<Result | undefined> => {
      const operationName = `${init.method || 'POST'} ${String(input)}`;
      return runMutation(operationName, async () => {
        const headers = new Headers(init.headers);
        headers.set('X-Demo-UI', 'v2');
        const response = await fetch(input, { ...init, headers });
        const payload = (await response.json().catch(() => null)) as
          | (Result & { error?: string })
          | null;

        if (!response.ok) {
          throw new Error(payload?.error || 'The demo action could not be completed.');
        }

        return payload as Result;
      });
    },
    [runMutation]
  );

  const value = useMemo<DemoMutationContextValue>(
    () => ({
      writeState,
      canMutate: writeState === 'enabled',
      refreshConfig,
      runMutation,
      mutationFetch,
    }),
    [mutationFetch, refreshConfig, runMutation, writeState]
  );

  return <DemoMutationContext.Provider value={value}>{children}</DemoMutationContext.Provider>;
}

export function useDemoMutation(): DemoMutationContextValue {
  const context = useContext(DemoMutationContext);
  if (!context) {
    throw new Error('useDemoMutation must be used within DemoMutationProvider');
  }
  return context;
}
