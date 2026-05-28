'use client';

import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { ProfileOverviewPayload } from '@/types/profile';

interface ProfilePermissionsTabProps {
  permissionSummary: ProfileOverviewPayload['permission_summary'];
}

function getAccessBadgeClass(accessLevel: number): string {
  if (accessLevel >= 5) return 'border-blue-500/40 bg-blue-500/15 text-blue-300';
  if (accessLevel >= 4) return 'border-green-500/40 bg-green-500/15 text-green-300';
  if (accessLevel >= 3) return 'border-amber-500/40 bg-amber-500/15 text-amber-300';
  return 'border-slate-500/40 bg-slate-500/15 text-slate-200';
}

export function ProfilePermissionsTab({ permissionSummary }: ProfilePermissionsTabProps) {
  const modules = permissionSummary.modules;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>My Module Access</CardTitle>
          <CardDescription>
            Your access is calculated from the user-based permissions matrix and your effective team.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-slate-900/30 p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Effective team</p>
            <p className="mt-1 text-sm font-medium text-foreground">
              {permissionSummary.effective_team_name || 'No team context'}
            </p>
          </div>

          {modules.length === 0 ? (
            <p className="text-sm text-muted-foreground">No module access has been assigned yet.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {modules.map((module) => (
                <div key={module.module_name} className="rounded-lg border border-border bg-slate-900/30 p-4">
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-foreground">{module.display_name}</p>
                      <p className="text-xs text-muted-foreground">{module.description}</p>
                    </div>
                    <Badge variant="outline" className={getAccessBadgeClass(module.access_level)}>
                      {module.access_label}
                    </Badge>
                  </div>
                  {module.requires_sensitive_pin ? (
                    <Badge variant="outline" className="border-avs-yellow/50 bg-avs-yellow/10 text-avs-yellow">
                      Sensitive PIN required
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cover While You Are Away</CardTitle>
          <CardDescription>Planned permissions handover workflow</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            A future update will let users nominate a suitable colleague to cover key responsibilities
            during leave or other planned absence. While active, the nominated person will receive
            time-limited access that reflects the responsibilities being covered, then automatically
            return to their normal permissions when the cover period ends.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

