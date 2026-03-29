'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { QuickLinkItem } from '@/lib/profile/quick-links';

interface ProfileQuickLinksProps {
  recentLinks: QuickLinkItem[];
  frequentLinks: QuickLinkItem[];
}

const quickLinkItemClass =
  'rounded-md border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-slate-800/30';

export function ProfileQuickLinks({ recentLinks, frequentLinks }: ProfileQuickLinksProps) {
  const hasLinks = recentLinks.length > 0 || frequentLinks.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Quick Links</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Recent pages</p>
          <div className="space-y-2">
            {recentLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent activity yet.</p>
            ) : (
              recentLinks.map((link) => (
                <Link
                  key={`recent-${link.path}`}
                  href={link.path}
                  className={`block ${quickLinkItemClass}`}
                >
                  {link.label}
                </Link>
              ))
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium text-foreground">Frequently used</p>
          <div className="space-y-2">
            {frequentLinks.length === 0 ? (
              <p className="text-sm text-muted-foreground">Usage data is still building.</p>
            ) : (
              frequentLinks.map((link) => (
                <Link
                  key={`frequent-${link.path}`}
                  href={link.path}
                  className={`flex items-center justify-between ${quickLinkItemClass}`}
                >
                  <span>{link.label}</span>
                  <span className="text-xs text-muted-foreground">{link.visitCount} visits</span>
                </Link>
              ))
            )}
          </div>
        </div>

        {!hasLinks ? (
          <p className="md:col-span-2 text-xs text-muted-foreground">
            Quick links will populate automatically as users browse modules and pages.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

