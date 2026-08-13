import type { ReactNode } from 'react';
import {
  AppPageHeader,
  AppPageShell,
  type AppPageShellProps,
} from '@/components/layout/AppPageShell';
import { SectionLoader } from '@/components/ui/section-loader';
import type { LoaderAccent } from '@/components/ui/page-loading-screen';
import { cn } from '@/lib/utils/cn';

interface AppPageLoadingShellProps {
  title: string;
  titleMeta?: ReactNode;
  description?: string;
  icon?: ReactNode;
  message?: string;
  accent?: LoaderAccent;
  width?: AppPageShellProps['width'];
  className?: string;
  loaderClassName?: string;
}

export function AppPageLoadingShell({
  title,
  titleMeta,
  description,
  icon,
  message = 'Loading...',
  accent,
  width,
  className,
  loaderClassName,
}: AppPageLoadingShellProps) {
  return (
    <AppPageShell width={width} className={className}>
      <AppPageHeader
        title={title}
        titleMeta={titleMeta}
        description={description}
        icon={icon}
      />
      <SectionLoader
        message={message}
        accent={accent}
        className={cn('min-h-[320px]', loaderClassName)}
      />
    </AppPageShell>
  );
}
