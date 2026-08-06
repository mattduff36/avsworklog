'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import permissionsAudit from '@/lib/config/permissions-secondary-audit.json';
import { getModuleBrandSurfaceClasses } from '@/lib/utils/module-brand-presentation';
import { cn } from '@/lib/utils/cn';
import { BookOpen } from 'lucide-react';

const ROLE_ORDER = ['Contractor', 'Employee', 'Supervisor', 'Manager', 'Admin'] as const;

interface ModuleAuditEntry {
  displayName: string;
  moduleName: string;
  matrixGate: string;
  minimumRole: string;
  byRole: Record<string, string>;
}

interface PermissionsAuditDocument {
  title: string;
  auditDate: string;
  matrixRule: string;
  modules: ModuleAuditEntry[];
  prdRelevantMismatches: string[];
}

interface GuideRoleBadgeProps {
  label: string;
  variant: 'destructive' | 'outline' | 'warning' | 'secondary';
  className?: string;
}

/** Aligns with Permissions tab role badges; Contractor/Employee use a white outline pill. */
function getGuideRoleBadge(role: string): GuideRoleBadgeProps {
  const normalized = role.trim();
  const label = normalized || 'Unknown';

  if (normalized === 'Contractor' || normalized === 'Employee') {
    return { label, variant: 'outline', className: 'border-white/70 text-foreground' };
  }
  if (normalized === 'Supervisor') {
    return {
      label,
      variant: 'outline',
      className: 'border-sky-400/50 bg-sky-500/20 text-sky-200',
    };
  }
  if (normalized === 'Manager') {
    return { label, variant: 'warning' };
  }
  if (normalized === 'Admin') {
    return { label, variant: 'destructive' };
  }
  return { label, variant: 'secondary' };
}

const auditDocument = permissionsAudit as PermissionsAuditDocument;

export function PermissionsGuide() {
  const modules = auditDocument.modules;
  const mismatchByModule = new Map<string, string[]>();

  for (const mismatch of auditDocument.prdRelevantMismatches || []) {
    const matched = modules.find((module) =>
      mismatch.toLowerCase().startsWith(module.displayName.toLowerCase())
    );
    if (!matched) continue;
    const existing = mismatchByModule.get(matched.moduleName) || [];
    existing.push(mismatch);
    mismatchByModule.set(matched.moduleName, existing);
  }

  return (
    <div className="space-y-6">
      <Card className="border-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <BookOpen className="h-5 w-5 text-avs-yellow" />
            Permission Guide
          </CardTitle>
          <CardDescription>
            Informational reference of what each job-role level can and cannot do per module.
            Sourced from the secondary permissions audit ({auditDocument.auditDate}). Live matrix
            overrides and team enablement may differ.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>{auditDocument.matrixRule}</p>
          {(auditDocument.prdRelevantMismatches?.length || 0) > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-amber-100">
              <p className="font-medium text-amber-200">Known mismatches</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {auditDocument.prdRelevantMismatches.map((mismatch) => (
                  <li key={mismatch}>{mismatch}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Accordion type="multiple" className="space-y-3">
        {modules.map((module) => {
          const moduleMismatches = mismatchByModule.get(module.moduleName) || [];
          const brandSurface = getModuleBrandSurfaceClasses(module.moduleName);
          const minRoleBadge = getGuideRoleBadge(module.minimumRole);
          return (
            <AccordionItem
              key={module.moduleName}
              value={module.moduleName}
              className={cn(
                'overflow-hidden rounded-lg border transition-colors',
                brandSurface.card,
                brandSurface.cardHover
              )}
            >
              <AccordionTrigger className="px-4 py-4 hover:no-underline">
                <div className="flex flex-col items-start gap-2 text-left sm:flex-row sm:items-center sm:gap-3">
                  <span className="font-semibold text-foreground">{module.displayName}</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">Min:</span>
                    <Badge
                      variant={minRoleBadge.variant}
                      className={cn('text-[10px]', minRoleBadge.className)}
                    >
                      {minRoleBadge.label}
                    </Badge>
                    <Badge variant="secondary">{module.matrixGate}</Badge>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="bg-slate-900 px-4 pb-4">
                <div className="space-y-3">
                  {ROLE_ORDER.map((role) => {
                    const detail = module.byRole[role];
                    if (!detail) return null;
                    const roleBadge = getGuideRoleBadge(role);
                    return (
                      <div
                        key={`${module.moduleName}-${role}`}
                        className="rounded-md border border-border bg-slate-900 p-3"
                      >
                        <Badge
                          variant={roleBadge.variant}
                          className={cn('text-[10px]', roleBadge.className)}
                        >
                          {roleBadge.label}
                        </Badge>
                        <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
                      </div>
                    );
                  })}
                  {moduleMismatches.length > 0 && (
                    <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-100">
                      {moduleMismatches.map((mismatch) => (
                        <p key={mismatch}>{mismatch}</p>
                      ))}
                    </div>
                  )}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}
