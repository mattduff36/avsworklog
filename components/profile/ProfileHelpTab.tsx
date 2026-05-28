'use client';

import Link from 'next/link';
import { AlertTriangle, BookOpen, Lightbulb, MessageSquareWarning } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProfileHelpArticleSummaryItem } from '@/types/profile';

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

export function ProfileHelpTab({ articles }: ProfileHelpTabProps) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Help Shortcuts</CardTitle>
          <CardDescription>Jump to the existing support, suggestions, and FAQ workflows.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {HELP_SHORTCUTS.map((shortcut) => {
            const Icon = shortcut.icon;
            return (
              <Link
                key={shortcut.href}
                href={shortcut.href}
                className="rounded-md border border-border p-3 transition-colors hover:bg-slate-800/30"
              >
                <div className="mb-2 flex items-center gap-2">
                  <Icon className="h-4 w-4 text-avs-yellow" />
                  <p className="text-sm font-semibold text-foreground">{shortcut.title}</p>
                </div>
                <p className="text-xs text-muted-foreground">{shortcut.description}</p>
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
            <p className="text-sm text-muted-foreground">
              No recommended articles are available yet. You can still browse the full FAQ from Help.
            </p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {articles.map((article) => (
                <Link
                  key={article.id}
                  href={`/help?tab=faq&category=${encodeURIComponent(article.category_slug)}`}
                  className="rounded-lg border border-border bg-slate-900/30 p-4 transition-colors hover:bg-slate-800/40"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{article.category_name}</Badge>
                    {article.module_name ? (
                      <Badge variant="outline" className="border-avs-yellow/40 bg-avs-yellow/10 text-avs-yellow">
                        Module help
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-sm font-semibold text-foreground">{article.title}</p>
                  {article.summary ? (
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{article.summary}</p>
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

