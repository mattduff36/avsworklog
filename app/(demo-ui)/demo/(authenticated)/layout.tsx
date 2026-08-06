import type { ReactNode } from 'react';
import { DemoAccessBoundary } from '@/components/demo-ui/demo-access-boundary';
import { DemoMutationProvider } from '@/components/demo-ui/demo-mutation-provider';
import { DemoShell } from '@/components/demo-ui/demo-shell';

interface DemoAuthenticatedLayoutProps {
  children: ReactNode;
}

export default function DemoAuthenticatedLayout({ children }: DemoAuthenticatedLayoutProps) {
  return (
    <DemoMutationProvider>
      <DemoShell>
        <DemoAccessBoundary>{children}</DemoAccessBoundary>
      </DemoShell>
    </DemoMutationProvider>
  );
}
