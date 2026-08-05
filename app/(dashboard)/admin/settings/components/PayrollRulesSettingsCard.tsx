'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Archive,
  Calculator,
  CalendarCheck,
  CircleAlert,
  FlaskConical,
  Loader2,
  Rocket,
  Save,
  Settings2,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { minutesToHours } from '@/lib/payroll/calculate';
import type {
  PayrollDayBand,
  PayrollRuleConfiguration,
  PayrollRuleSetKey,
  PayrollTreatment,
  PayrollWeekBreakdown,
} from '@/lib/payroll/types';
import type {
  PayrollAdminMatrix,
  PayrollProfileAssignmentInput,
  PayrollRuleSetAdminRecord,
  PayrollTeamAssignmentInput,
} from '@/types/payroll-admin';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const RULE_KEYS: PayrollRuleSetKey[] = ['lorries', 'civils', 'plant', 'others'];
const TREATMENTS: Array<{ value: PayrollTreatment; label: string }> = [
  { value: 'basic', label: 'Basic' },
  { value: 'overtime', label: 'Overtime' },
  { value: 'double_time', label: 'Double Time' },
];
const RULE_LABELS: Record<PayrollRuleSetKey, string> = {
  lorries: 'Transport',
  civils: 'Civils',
  plant: 'Plant',
  others: 'Others',
};
const HELPER_TEXT_CLASS = 'text-xs leading-snug text-slate-400';

interface SectionHeadingProps {
  step: number;
  title: string;
  description: string;
  icon: ReactNode;
}

function SectionHeading({ step, title, description, icon }: SectionHeadingProps) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-avs-yellow/30 bg-avs-yellow/10 text-avs-yellow">
        {icon}
      </div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="border-avs-yellow/30 text-avs-yellow">
            Step {step}
          </Badge>
          <h4 className="font-semibold text-foreground">{title}</h4>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-slate-400">{description}</p>
      </div>
    </div>
  );
}

interface FieldControlProps {
  label: string;
  htmlFor: string;
  helperText: string;
  children: ReactNode;
}

function FieldControl({ label, htmlFor, helperText, children }: FieldControlProps) {
  return (
    <div className="flex h-full flex-col gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      <p className={`min-h-[2.25rem] ${HELPER_TEXT_CLASS}`}>{helperText}</p>
    </div>
  );
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getUpcomingSundays(count: number): string[] {
  const today = new Date();
  const localToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const daysUntilSunday = (7 - localToday.getDay()) % 7;
  const firstSunday = new Date(localToday);
  firstSunday.setDate(localToday.getDate() + daysUntilSunday);

  return Array.from({ length: count }, (_, index) => {
    const sunday = new Date(firstSunday);
    sunday.setDate(firstSunday.getDate() + index * 7);
    return formatLocalIsoDate(sunday);
  });
}

function formatSundayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function minutesToDurationInput(minutes: number): string {
  const safeMinutes = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
}

function durationInputToMinutes(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

interface ApiResponse extends Partial<PayrollAdminMatrix> {
  success?: boolean;
  error?: string;
  breakdown?: PayrollWeekBreakdown;
}

async function parseResponse(response: Response): Promise<ApiResponse> {
  const payload = (await response.json()) as ApiResponse;
  if (!response.ok) throw new Error(payload.error || 'Payroll settings request failed');
  return payload;
}

function latestEditableConfiguration(rule: PayrollRuleSetAdminRecord): PayrollRuleConfiguration {
  const version = rule.versions.find((candidate) => candidate.status === 'draft') || rule.versions[0];
  if (!version) throw new Error(`${rule.name} has no configuration`);
  return structuredClone(version.configuration);
}

function RuleEditor({
  rule,
  onSaved,
}: {
  rule: PayrollRuleSetAdminRecord;
  onSaved: (matrix: PayrollAdminMatrix) => void;
}) {
  const [configuration, setConfiguration] = useState(() => latestEditableConfiguration(rule));
  const [saving, setSaving] = useState(false);
  const [lifecycleVersionId, setLifecycleVersionId] = useState<string | null>(null);

  useEffect(() => {
    setConfiguration(latestEditableConfiguration(rule));
  }, [rule]);

  function updateBand(day: number, patch: Partial<PayrollDayBand>) {
    setConfiguration((current) => ({
      ...current,
      dayBands: {
        ...current.dayBands,
        [day]: { ...current.dayBands[day], ...patch },
      },
    }));
  }

  async function saveDraft() {
    setSaving(true);
    try {
      const payload = await parseResponse(await fetch('/api/admin/settings/payroll-rules', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configuration }),
      }));
      onSaved(payload as PayrollAdminMatrix);
      toast.success(`${rule.name} payroll draft saved`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save payroll draft');
    } finally {
      setSaving(false);
    }
  }

  async function runLifecycleAction(
    action: 'delete_draft' | 'archive_version',
    versionId: string,
    confirmation: string
  ) {
    if (!window.confirm(confirmation)) return;
    setLifecycleVersionId(versionId);
    try {
      const payload = await parseResponse(await fetch('/api/admin/settings/payroll-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, versionId }),
      }));
      onSaved(payload as PayrollAdminMatrix);
      toast.success(action === 'delete_draft' ? 'Payroll draft deleted' : 'Payroll version archived');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Payroll version action failed');
    } finally {
      setLifecycleVersionId(null);
    }
  }

  const activeEffectiveWeeks = rule.versions
    .filter((version) => version.status === 'active' && version.effective_week_ending)
    .map((version) => version.effective_week_ending as string);

  return (
    <div className="space-y-5 rounded-lg border border-border bg-background/60 p-4 shadow-inner shadow-black/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-foreground">Version history</h4>
          <p className="text-xs text-muted-foreground">
            {rule.versions.find((version) => version.status === 'draft')
              ? 'Editing draft version'
              : 'Creates the next draft version'}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          Activated versions are read-only; superseded versions can be archived.
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        {rule.versions.map((version) => {
          const hasNewerActiveReplacement = Boolean(
            version.effective_week_ending
            && activeEffectiveWeeks.some((week) => week > version.effective_week_ending!)
          );
          return (
            <div key={version.id} className="flex items-center gap-2 rounded border border-border px-2 py-1 text-xs">
              <span>v{version.version_number}</span>
              <Badge variant="outline">{version.status}</Badge>
              {version.effective_week_ending && <span>{version.effective_week_ending}</span>}
              {version.status === 'draft' && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={lifecycleVersionId === version.id}
                  onClick={() => runLifecycleAction(
                    'delete_draft',
                    version.id,
                    `Delete ${rule.name} draft version ${version.version_number}?`
                  )}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Delete draft version {version.version_number}</span>
                </Button>
              )}
              {version.status === 'active' && hasNewerActiveReplacement && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={lifecycleVersionId === version.id}
                  onClick={() => runLifecycleAction(
                    'archive_version',
                    version.id,
                    `Archive ${rule.name} version ${version.version_number}?`
                  )}
                >
                  <Archive className="h-3.5 w-3.5" />
                  <span className="sr-only">Archive version {version.version_number}</span>
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid items-stretch gap-3 md:grid-cols-2 lg:grid-cols-4">
        <FieldControl
          label="Break threshold"
          htmlFor={`${rule.rule_key}-break-threshold`}
          helperText="Shift length before the deduction applies."
        >
          <Input
            id={`${rule.rule_key}-break-threshold`}
            type="time"
            step={900}
            value={minutesToDurationInput(configuration.breakThresholdMinutes)}
            onChange={(event) => {
              const nextMinutes = durationInputToMinutes(event.target.value);
              if (nextMinutes === null) return;
              setConfiguration((current) => ({
                ...current,
                breakThresholdMinutes: nextMinutes,
              }));
            }}
          />
        </FieldControl>
        <FieldControl
          label="Break deduction"
          htmlFor={`${rule.rule_key}-break-deduction`}
          helperText="Time removed once the threshold is reached."
        >
          <Input
            id={`${rule.rule_key}-break-deduction`}
            type="time"
            step={900}
            value={minutesToDurationInput(configuration.breakDeductionMinutes)}
            onChange={(event) => {
              const nextMinutes = durationInputToMinutes(event.target.value);
              if (nextMinutes === null) return;
              setConfiguration((current) => ({
                ...current,
                breakDeductionMinutes: nextMinutes,
              }));
            }}
          />
        </FieldControl>
        <FieldControl
          label="Bank holiday"
          htmlFor={`${rule.rule_key}-bank-holiday-rate`}
          helperText="Rate applied to all bank-holiday hours."
        >
          <Select
            value={configuration.bankHolidayTreatment}
            onValueChange={(value: PayrollTreatment) => setConfiguration((current) => ({
              ...current,
              bankHolidayTreatment: value,
            }))}
          >
            <SelectTrigger id={`${rule.rule_key}-bank-holiday-rate`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FieldControl>
        <FieldControl
          label="Night Shift"
          htmlFor={`${rule.rule_key}-night-shift-rate`}
          helperText="Optional whole-shift premium selected on the timesheet."
        >
          <Select
            value={configuration.nightShiftTreatment || 'none'}
            onValueChange={(value) => setConfiguration((current) => ({
              ...current,
              nightShiftTreatment: value === 'none' ? null : value as PayrollTreatment,
            }))}
          >
            <SelectTrigger id={`${rule.rule_key}-night-shift-rate`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No premium</SelectItem>
              {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </FieldControl>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px] space-y-2">
          <div className="grid grid-cols-[120px_1fr_150px_1fr] gap-2 border-b border-border pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <span>Day</span>
            <span>Starting rate</span>
            <span>Minutes at rate</span>
            <span>Remaining rate</span>
          </div>
          {DAY_NAMES.map((name, index) => {
            const day = index + 1;
            const band = configuration.dayBands[day];
            return (
              <div key={name} className="grid grid-cols-[120px_1fr_150px_1fr] items-center gap-2">
                <span className="text-sm font-medium">{name}</span>
                <Select value={band.treatment} onValueChange={(value: PayrollTreatment) => updateBand(day, { treatment: value })}>
                  <SelectTrigger aria-label={`${name} starting rate`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`${name} minutes at starting rate`}
                  type="number"
                  min={0}
                  step={15}
                  placeholder="No limit"
                  value={band.upToMinutes ?? ''}
                  onChange={(event) => {
                    const upToMinutes = event.target.value ? Number(event.target.value) : undefined;
                    updateBand(day, {
                      upToMinutes,
                      remainderTreatment: upToMinutes ? band.remainderTreatment || band.treatment : undefined,
                    });
                  }}
                />
                <Select
                  disabled={band.upToMinutes === undefined}
                  value={band.remainderTreatment || band.treatment}
                  onValueChange={(value: PayrollTreatment) => updateBand(day, { remainderTreatment: value })}
                >
                  <SelectTrigger aria-label={`${name} remaining rate`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Saving updates the draft only. It does not change live payroll calculations.
        </p>
        <Button onClick={saveDraft} disabled={saving} className="shrink-0">
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          Save {rule.name} draft
        </Button>
      </div>
    </div>
  );
}

export function PayrollRulesSettingsCard() {
  const [matrix, setMatrix] = useState<PayrollAdminMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [effectiveWeekEnding, setEffectiveWeekEnding] = useState('');
  const [teamAssignments, setTeamAssignments] = useState<PayrollTeamAssignmentInput[]>([]);
  const [profileAssignments, setProfileAssignments] = useState<PayrollProfileAssignmentInput[]>([]);
  const [profileSearch, setProfileSearch] = useState('');
  const [activating, setActivating] = useState(false);
  const [testRuleKey, setTestRuleKey] = useState<PayrollRuleSetKey>('plant');
  const [testDay, setTestDay] = useState('1');
  const [testStart, setTestStart] = useState('07:30');
  const [testFinish, setTestFinish] = useState('18:00');
  const [testNight, setTestNight] = useState(false);
  const [testBankHoliday, setTestBankHoliday] = useState(false);
  const [testResult, setTestResult] = useState<PayrollWeekBreakdown | null>(null);
  const upcomingSundays = useMemo(() => getUpcomingSundays(6), []);
  const effectiveWeekOptions = useMemo(() => {
    if (effectiveWeekEnding && !upcomingSundays.includes(effectiveWeekEnding)) {
      return [effectiveWeekEnding, ...upcomingSundays];
    }
    return upcomingSundays;
  }, [effectiveWeekEnding, upcomingSundays]);

  const load = useCallback(async () => {
    try {
      const payload = await parseResponse(await fetch('/api/admin/settings/payroll-rules'));
      setMatrix(payload as PayrollAdminMatrix);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to load payroll rules');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (effectiveWeekEnding || upcomingSundays.length === 0) return;
    setEffectiveWeekEnding(upcomingSundays[0]);
  }, [effectiveWeekEnding, upcomingSundays]);

  useEffect(() => {
    if (!matrix || teamAssignments.length > 0) return;
    const selectedTeams = matrix.teams.map((team) => {
      const existing = [...matrix.teamAssignments]
        .filter((assignment) => assignment.teamId === team.id)
        .sort((left, right) => right.effectiveWeekEnding.localeCompare(left.effectiveWeekEnding))[0];
      if (existing) return { teamId: team.id, ruleSetKey: existing.ruleSetKey };
      const normalized = team.name.toLowerCase();
      const ruleSetKey: PayrollRuleSetKey = normalized.includes('transport')
        ? 'lorries'
        : normalized.includes('plant')
          ? 'plant'
          : 'civils';
      return { teamId: team.id, ruleSetKey };
    });
    if (selectedTeams.length > 0) setTeamAssignments(selectedTeams);
  }, [matrix, teamAssignments.length]);

  useEffect(() => {
    if (!matrix || profileAssignments.length > 0) return;
    if (matrix.profileAssignments.length > 0) {
      setProfileAssignments(matrix.profileAssignments.map((assignment) => ({
        profileId: assignment.profileId,
        ruleSetKey: assignment.ruleSetKey,
      })));
    }
  }, [matrix, profileAssignments.length]);

  const filteredProfiles = useMemo(() => {
    if (!matrix) return [];
    const query = profileSearch.trim().toLowerCase();
    return matrix.profiles.filter((profile) => !query
      || profile.full_name.toLowerCase().includes(query)
      || (profile.employee_id || '').toLowerCase().includes(query));
  }, [matrix, profileSearch]);

  function ruleConfiguration(key: PayrollRuleSetKey): PayrollRuleConfiguration | null {
    const rule = matrix?.rules.find((candidate) => candidate.rule_key === key);
    return rule ? latestEditableConfiguration(rule) : null;
  }

  async function runTestCalculator() {
    const configuration = ruleConfiguration(testRuleKey);
    if (!configuration) return;
    try {
      const payload = await parseResponse(await fetch('/api/admin/settings/payroll-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'test',
          configuration,
          weekEnding: '2026-08-09',
          days: [{
            dayOfWeek: Number(testDay),
            timeStarted: testStart,
            timeFinished: testFinish,
            nightShift: testNight,
            bankHoliday: testBankHoliday,
          }],
        }),
      }));
      setTestResult(payload.breakdown || null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Test calculation failed');
    }
  }

  async function activate() {
    if (!matrix) return;
    setActivating(true);
    try {
      const payload = await parseResponse(await fetch('/api/admin/settings/payroll-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'activate',
          effectiveWeekEnding,
          teamAssignments,
          profileAssignments,
        }),
      }));
      setMatrix(payload as PayrollAdminMatrix);
      toast.success('Payroll rollout activated');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Payroll activation failed');
    } finally {
      setActivating(false);
    }
  }

  function setProfileRule(profileId: string, ruleSetKey: PayrollRuleSetKey | 'none') {
    setProfileAssignments((current) => {
      const without = current.filter((item) => item.profileId !== profileId);
      if (ruleSetKey === 'none') return without;
      return [...without, { profileId, ruleSetKey }];
    });
  }

  return (
    <Card id="payroll-rules" className="scroll-mt-6 overflow-hidden border-border bg-slate-900/60">
      <CardHeader className="border-b border-border bg-gradient-to-r from-avs-yellow/10 via-transparent to-transparent">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-white">
              <ShieldCheck className="h-5 w-5 text-avs-yellow" />
              Timesheet Payroll Rules
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl text-sm leading-relaxed text-slate-400">
              Configure and test the signed Transport, Civils, Plant and Others rules before selecting
              the Sunday they become active. Approved payroll snapshots cannot be edited later.
            </CardDescription>
          </div>
          {matrix ? (
            <Badge
              variant="outline"
              className={matrix.rolloutWeekEnding
                ? 'w-fit border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
                : 'w-fit border-amber-500/40 bg-amber-500/10 text-amber-200'}
            >
              {matrix.rolloutWeekEnding ? `Active from ${matrix.rolloutWeekEnding}` : 'Not activated'}
            </Badge>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-8 pt-6">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              icon: <Settings2 className="h-4 w-4" />,
              title: '1. Configure drafts',
              description: 'Review each rule set and save any changes. Drafts do not affect payroll.',
            },
            {
              icon: <FlaskConical className="h-4 w-4" />,
              title: '2. Test a shift',
              description: 'Check sample hours, premiums, and bank-holiday treatment before rollout.',
            },
            {
              icon: <Rocket className="h-4 w-4" />,
              title: '3. Assign and activate',
              description: 'Confirm team mappings, exceptions, and the client-approved Sunday.',
            },
          ].map((item) => (
            <div key={item.title} className="rounded-lg border border-border bg-background/60 p-4">
              <div className="mb-2 flex items-center gap-2 font-semibold text-foreground">
                <span className="text-avs-yellow">{item.icon}</span>
                {item.title}
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
            </div>
          ))}
        </div>

        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading payroll configuration…</div>}
        {!loading && !matrix && <p className="text-sm text-destructive">Payroll configuration could not be loaded.</p>}
        {matrix && (
          <>
            <section aria-labelledby="payroll-rule-drafts-heading" className="space-y-4">
              <div id="payroll-rule-drafts-heading">
                <SectionHeading
                  step={1}
                  title="Configure rule drafts"
                  description="Open one rule set at a time. Save creates or updates a draft; live payroll remains unchanged until activation."
                  icon={<Settings2 className="h-4 w-4" />}
                />
              </div>
              <Accordion type="single" collapsible defaultValue={matrix.rules[0]?.rule_key} className="space-y-3">
                {matrix.rules.map((rule) => {
                  const draft = rule.versions.find((version) => version.status === 'draft');
                  return (
                    <AccordionItem
                      key={rule.id}
                      value={rule.rule_key}
                      className="overflow-hidden rounded-lg border border-border bg-slate-950/40 px-4"
                    >
                      <AccordionTrigger className="gap-3 py-4 text-left hover:no-underline">
                        <span className="flex flex-1 flex-wrap items-center gap-3">
                          <span className="font-semibold text-foreground">{rule.name}</span>
                          <Badge variant={rule.status === 'active' ? 'default' : 'secondary'}>
                            {rule.status}
                          </Badge>
                          <span className="text-xs font-normal text-muted-foreground">
                            {draft ? `Draft v${draft.version_number} ready to edit` : 'Open to create the next draft'}
                          </span>
                        </span>
                      </AccordionTrigger>
                      <AccordionContent className="pb-4">
                        <RuleEditor rule={rule} onSaved={setMatrix} />
                      </AccordionContent>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </section>

            <section aria-labelledby="payroll-test-heading" className="space-y-4 rounded-xl border border-border bg-background/60 p-5">
              <div id="payroll-test-heading">
                <SectionHeading
                  step={2}
                  title="Test calculator"
                  description="Run a single sample shift against the current draft. Tests are read-only and do not save or activate anything."
                  icon={<Calculator className="h-4 w-4" />}
                />
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-test-rule-set">Rule set</Label>
                  <Select value={testRuleKey} onValueChange={(value: PayrollRuleSetKey) => setTestRuleKey(value)}>
                    <SelectTrigger id="payroll-test-rule-set"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {RULE_KEYS.map((key) => <SelectItem key={key} value={key}>{RULE_LABELS[key]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-test-day">Day worked</Label>
                  <Select value={testDay} onValueChange={setTestDay}>
                    <SelectTrigger id="payroll-test-day"><SelectValue /></SelectTrigger>
                    <SelectContent>{DAY_NAMES.map((name, index) => <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-test-start">Start time</Label>
                  <Input id="payroll-test-start" type="time" step={900} value={testStart} onChange={(event) => setTestStart(event.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="payroll-test-finish">Finish time</Label>
                  <Input id="payroll-test-finish" type="time" step={900} value={testFinish} onChange={(event) => setTestFinish(event.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <label className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-slate-950/40 px-3 text-sm">
                  <Checkbox checked={testNight} onCheckedChange={(value) => setTestNight(value === true)} />
                  Night Shift
                </label>
                <label className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-slate-950/40 px-3 text-sm">
                  <Checkbox checked={testBankHoliday} onCheckedChange={(value) => setTestBankHoliday(value === true)} />
                  Bank holiday
                </label>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <Button variant="outline" onClick={runTestCalculator}>
                  <FlaskConical className="mr-2 h-4 w-4" />
                  Run test
                </Button>
                {testResult ? (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100" aria-live="polite">
                    <span>Basic <strong>{minutesToHours(testResult.basicMinutes).toFixed(2)}h</strong></span>
                    <span>Overtime <strong>{minutesToHours(testResult.overtimeMinutes).toFixed(2)}h</strong></span>
                    <span>Double Time <strong>{minutesToHours(testResult.doubleTimeMinutes).toFixed(2)}h</strong></span>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">The calculated rate split will appear here.</p>
                )}
              </div>
            </section>

            <section aria-labelledby="payroll-activation-heading" className="space-y-5 rounded-xl border border-avs-yellow/30 bg-avs-yellow/5 p-5">
              <div id="payroll-activation-heading">
                <SectionHeading
                  step={3}
                  title="Assign teams and activate"
                  description="Complete this section only after the client confirms the cutover week and the draft test results are correct."
                  icon={<Rocket className="h-4 w-4" />}
                />
              </div>

              <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-amber-100">
                <CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" />
                <div>
                  <p className="font-semibold">Activation changes payroll processing</p>
                  <p className="mt-1 text-sm leading-relaxed text-amber-100/80">
                    The selected Sunday is inclusive. That week and later weeks use the new rules; earlier
                    weeks keep legacy behaviour. Confirm the date and assignments before activating.
                  </p>
                </div>
              </div>

              <div className="max-w-md space-y-1.5">
                <Label htmlFor="payroll-effective-week">Effective week ending</Label>
                <Select
                  value={effectiveWeekEnding || undefined}
                  onValueChange={setEffectiveWeekEnding}
                >
                  <SelectTrigger id="payroll-effective-week" className="bg-slate-950/60">
                    <SelectValue placeholder="Select a Sunday" />
                  </SelectTrigger>
                  <SelectContent>
                    {effectiveWeekOptions.map((sunday) => (
                      <SelectItem key={sunday} value={sunday}>
                        {formatSundayLabel(sunday)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className={HELPER_TEXT_CLASS}>
                  Choose the client-approved Sunday. Only the next six Sundays are listed.
                </p>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                <div className="flex flex-col space-y-3 rounded-lg border border-border bg-background/70 p-4">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 text-sky-400" />
                    <div>
                      <h5 className="font-semibold text-foreground">Team rule assignments</h5>
                      <p className={HELPER_TEXT_CLASS}>
                        Every employee inherits their team&apos;s rule unless they have an override.
                      </p>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {matrix.teams.map((team) => {
                      const assignment = teamAssignments.find((item) => item.teamId === team.id);
                      return (
                        <div key={team.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-slate-950/40 p-3">
                          <span className="text-sm font-medium">{team.name}</span>
                          <Select
                            value={assignment?.ruleSetKey || 'civils'}
                            onValueChange={(value: PayrollRuleSetKey) => setTeamAssignments((current) => [
                              ...current.filter((item) => item.teamId !== team.id),
                              { teamId: team.id, ruleSetKey: value },
                            ])}
                          >
                            <SelectTrigger
                              aria-label={`Payroll rule for ${team.name}`}
                              className="w-36"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RULE_KEYS.map((key) => <SelectItem key={key} value={key}>{RULE_LABELS[key]}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="relative min-h-[22rem] xl:min-h-0">
                  <div className="flex h-full flex-col space-y-3 rounded-lg border border-border bg-background/70 p-4 xl:absolute xl:inset-0">
                    <div className="flex shrink-0 items-center gap-2">
                      <CalendarCheck className="h-4 w-4 text-emerald-400" />
                      <div>
                        <h5 className="font-semibold text-foreground">Individual payroll overrides</h5>
                        <p className={HELPER_TEXT_CLASS}>
                          Use only for exceptions. At least three employees must be assigned to Others.
                        </p>
                      </div>
                    </div>
                    <Input
                      aria-label="Search payroll profile overrides"
                      placeholder="Search by employee name or ID…"
                      value={profileSearch}
                      onChange={(event) => setProfileSearch(event.target.value)}
                      className="shrink-0 bg-slate-950/60"
                    />
                    <div className="min-h-0 flex-1 space-y-1 overflow-y-auto rounded border border-border bg-slate-950/30 p-2">
                      {filteredProfiles.map((profile) => {
                        const assignment = profileAssignments.find((item) => item.profileId === profile.id);
                        return (
                          <div key={profile.id} className="flex items-center justify-between gap-2 rounded p-2 text-sm hover:bg-muted/50">
                            <span>{profile.full_name}{profile.employee_id ? ` (${profile.employee_id})` : ''}</span>
                            <Select
                              value={assignment?.ruleSetKey || 'none'}
                              onValueChange={(value: PayrollRuleSetKey | 'none') => setProfileRule(profile.id, value)}
                            >
                              <SelectTrigger
                                aria-label={`Payroll override for ${profile.full_name}`}
                                className="w-36"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Use team rule</SelectItem>
                                {RULE_KEYS.map((key) => <SelectItem key={key} value={key}>{RULE_LABELS[key]}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                        );
                      })}
                      {filteredProfiles.length === 0 ? (
                        <p className="p-4 text-center text-sm text-muted-foreground">No employees match this search.</p>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>

              {matrix.rolloutWeekEnding ? (
                <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
                  <p className="font-semibold text-emerald-200">Current rollout: {matrix.rolloutWeekEnding}</p>
                  <p className="mt-1 text-sm text-emerald-100/75">
                    {matrix.impactedUnapprovedTimesheets} unapproved timesheet(s) are currently within the rollout period.
                  </p>
                </div>
              ) : null}

              <div className="flex flex-col gap-3 border-t border-avs-yellow/20 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
                  Activation creates immutable versions and assignments. Review the Sunday, team rules,
                  employee overrides, and calculator results before continuing.
                </p>
                <Button
                  onClick={activate}
                  disabled={activating || !effectiveWeekEnding}
                  className="shrink-0 bg-avs-yellow text-slate-950 hover:bg-avs-yellow-hover"
                >
                  {activating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}
                  {matrix.rolloutWeekEnding ? 'Activate new payroll versions' : 'Activate signed payroll rules'}
                </Button>
              </div>
            </section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
