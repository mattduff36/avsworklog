'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LogOut, Menu, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { useDemoMutation } from '@/components/demo-ui/demo-mutation-provider';
import {
  DEMO_NAV_ROUTES,
  getDemoRoute,
} from '@/components/demo-ui/route-manifest';

interface DemoShellProps {
  children: ReactNode;
}

interface DemoNavProps {
  onNavigate?: () => void;
}

function isRouteActive(pathname: string, href: string): boolean {
  if (href === '/demo/dashboard') return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function DemoNav({ onNavigate }: DemoNavProps) {
  const pathname = usePathname();

  return (
    <nav className="dui-nav" aria-label="Fresh UI demo">
      {DEMO_NAV_ROUTES.map((route) => {
        const Icon = route.icon;
        const active = isRouteActive(pathname, route.href);
        return (
          <Link
            key={route.href}
            href={route.href}
            className={`dui-nav-link dui-accent-${route.accent}${active ? ' is-active' : ''}`}
            aria-current={active ? 'page' : undefined}
            onClick={onNavigate}
          >
            <Icon aria-hidden="true" />
            <span>{route.shortLabel}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function DemoShell({ children }: DemoShellProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { profile, signOut } = useAuth();
  const { writeState } = useDemoMutation();
  const currentRoute = getDemoRoute(pathname);
  const writeLabel =
    writeState === 'enabled'
      ? 'Writes enabled'
      : writeState === 'loading'
        ? 'Checking write access'
        : 'Read-only';

  return (
    <div className={`dui-app-shell dui-accent-${currentRoute?.accent || 'yellow'}`}>
      <aside className="dui-rail">
        <Link href="/demo" className="dui-brand" aria-label="Squires Fresh UI demo map">
          <span>S</span>
          <strong>SQUIRES</strong>
          <small>Fresh UI</small>
        </Link>
        <DemoNav />
        <div className="dui-rail-user">
          <span>{profile?.full_name || 'Signed in'}</span>
          <button type="button" onClick={() => void signOut()} aria-label="Sign out">
            <LogOut aria-hidden="true" />
          </button>
        </div>
      </aside>

      <div className="dui-workspace">
        <header className="dui-mobile-header">
          <Link href="/demo" className="dui-mobile-brand">
            SQUIRES
          </Link>
          <span>{currentRoute?.shortLabel || 'Fresh UI'}</span>
          <button
            type="button"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-label={mobileMenuOpen ? 'Close demo navigation' : 'Open demo navigation'}
            aria-expanded={mobileMenuOpen}
          >
            {mobileMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </header>

        {mobileMenuOpen ? (
          <div className="dui-mobile-nav">
            <DemoNav onNavigate={() => setMobileMenuOpen(false)} />
          </div>
        ) : null}

        <div className="dui-live-banner">
          <strong>Fresh UI demo - live data</strong>
          <span className={`dui-write-state is-${writeState}`}>{writeLabel}</span>
        </div>

        <main className="dui-main">{children}</main>
      </div>
    </div>
  );
}
