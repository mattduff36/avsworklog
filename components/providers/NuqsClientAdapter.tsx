'use client';

import dynamic from 'next/dynamic';
import { PageLoader } from '@/components/ui/page-loader';

const NuqsAdapterInner = dynamic(
  () => import('@/components/providers/NuqsAdapterInner').then((mod) => mod.NuqsAdapterInner),
  {
    ssr: false,
    loading: () => <PageLoader message="Loading SquiresApp..." />,
  }
);

export function NuqsClientAdapter({
  children,
}: {
  children: React.ReactNode;
}) {
  return <NuqsAdapterInner>{children}</NuqsAdapterInner>;
}
