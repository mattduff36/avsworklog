'use client';

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import permissionsAudit from '@/lib/config/permissions-secondary-audit.json';
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
          return (
            <AccordionItem
              key={module.moduleName}
              value={module.moduleName}
              className="rounded-lg border border-border bg-card px-4"
            >
              <AccordionTrigger className="py-4 hover:no-underline">
                <div className="flex flex-col items-start gap-2 text-left sm:flex-row sm:items-center sm:gap-3">
                  <span className="font-semibold text-foreground">{module.displayName}</span>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">Min: {module.minimumRole}</Badge>
                    <Badge variant="secondary">{module.matrixGate}</Badge>
                  </div>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-4">
                <div className="space-y-3">
                  {ROLE_ORDER.map((role) => {
                    const detail = module.byRole[role];
                    if (!detail) return null;
                    return (
                      <div
                        key={`${module.moduleName}-${role}`}
                        className="rounded-md border border-border bg-muted/30 p-3"
                      >
                        <p className="text-sm font-semibold text-foreground">{role}</p>
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
