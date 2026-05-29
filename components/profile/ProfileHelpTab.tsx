'use client';

import Link from 'next/link';
import { AlertTriangle, BookOpen, Lightbulb, MessageSquareWarning } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProfileHelpArticleSummaryItem } from '@/types/profile';
import type { ModuleName } from '@/types/roles';

interface ProfileHelpTabProps {
  articles: ProfileHelpArticleSummaryItem[];
}

const HELP_SHORTCUTS = [
  {
    href: '/help?tab=errors',
    title: 'Report an issue',
    description: 'Open the error reporting workflow.',
    icon: AlertTriangle,
  },
  {
    href: '/help?tab=suggest',
    title: 'Suggest an improvement',
    description: 'Share an idea with the team.',
    icon: Lightbulb,
  },
  {
    href: '/help?tab=my-suggestions',
    title: 'Track suggestions',
    description: 'Review updates on your submitted suggestions.',
    icon: MessageSquareWarning,
  },
  {
    href: '/help?tab=faq',
    title: 'Browse FAQs',
    description: 'Search all help articles available to you.',
    icon: BookOpen,
  },
];

function getModuleHelpBadgeClass(moduleName: ModuleName | null): string {
  if (!moduleName) return 'border-avs-yellow/40 bg-avs-yellow/10 text-avs-yellow';

  if (moduleName === 'timesheets') return 'border-timesheet/40 bg-timesheet/10 text-timesheet';
  if (moduleName === 'inspections') return 'border-inspection/40 bg-inspection/10 text-inspection';
  if (moduleName === 'plant-inspections') {
    return 'border-plant-inspection/40 bg-plant-inspection/10 text-plant-inspection';
  }
  if (moduleName === 'hgv-inspections') return 'border-hgv-inspection/40 bg-hgv-inspection/10 text-hgv-inspection';
  if (moduleName === 'rams') return 'border-rams/40 bg-rams/10 text-rams';
  if (moduleName === 'absence') return 'border-absence/40 bg-absence/10 text-absence';
  if (moduleName === 'maintenance') return 'border-maintenance/40 bg-maintenance/10 text-maintenance';
  if (moduleName === 'workshop-tasks') return 'border-workshop/40 bg-workshop/10 text-workshop';
  if (moduleName === 'inventory') return 'border-inventory/40 bg-inventory/10 text-inventory';
  if (moduleName === 'reminders') return 'border-reminders/40 bg-reminders/10 text-reminders';

  return 'border-avs-yellow/40 bg-avs-yellow/10 text-avs-yellow';
}

export function ProfileHelpTab({ articles }: ProfileHelpTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Help Shortcuts</CardTitle>
          <CardDescription>Jump to the existing support, suggestions, and FAQ workflows.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {HELP_SHORTCUTS.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.href}
                href={shortcut.href}
                className="min-h-32 rounded-lg border border-border p-4 transition-colors hover:bg-slate-800/30 sm:min-h-0 sm:rounded-md sm:p-3"
              >
                <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
                  <Icon className="h-6 w-6 text-avs-yellow sm:h-4 sm:w-4" />
                  <p className="text-base font-semibold leading-tight text-foreground sm:text-sm">{shortcut.title}</p>
                </div>
                <p className="text-sm leading-snug text-muted-foreground sm:text-xs">{shortcut.description}</p>
              </Link>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recommended Articles</CardTitle>
          <CardDescription>Helpful FAQ articles based on your available modules.</CardDescription>
        </CardHeader>
        <CardContent>
          {articles.length === 0 ? (
            <p className="text-base text-muted-foreground sm:text-sm">
              No recommended articles are available yet. You can still browse the full FAQ from Help.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {articles.map((article) => (
                <Link
                  key={article.id}
                  href={`/help?tab=faq&category=${encodeURIComponent(article.category_slug)}`}
                  className="min-h-28 rounded-lg border border-border bg-slate-900/30 p-5 transition-colors hover:bg-slate-800/40 sm:min-h-0 sm:p-4"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline" className="px-2.5 py-1 text-sm sm:px-2 sm:py-0.5 sm:text-xs">{article.category_name}</Badge>
                    {article.module_name ? (
                      <Badge variant="outline" className={`${getModuleHelpBadgeClass(article.module_name)} px-2.5 py-1 text-sm sm:px-2 sm:py-0.5 sm:text-xs`}>
                        Module help
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-lg font-semibold text-foreground sm:text-sm">{article.title}</p>
                  {article.summary ? (
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground sm:text-xs">{article.summary}</p>
                  ) : null}
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

