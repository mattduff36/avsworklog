'use client';

import { NuqsAdapter } from 'nuqs/adapters/next/app';

export function NuqsAdapterInner({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NuqsAdapter>{children}</NuqsAdapter>;
}
