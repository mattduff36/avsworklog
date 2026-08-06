import type { ReactNode } from 'react';
import '../../demo-ui.css';

interface DemoRootLayoutProps {
  children: ReactNode;
}

export default function DemoRootLayout({ children }: DemoRootLayoutProps) {
  return <div data-ui="v2">{children}</div>;
}
