'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Calculator, Loader2, Save, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
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
    <div className="space-y-4 rounded-lg border border-border bg-background/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="font-semibold text-foreground">{rule.name}</h4>
          <p className="text-xs text-muted-foreground">
            {rule.versions.find((version) => version.status === 'draft')
              ? 'Editing draft version'
              : 'Creates the next draft version'}
          </p>
        </div>
        <Badge variant={rule.status === 'active' ? 'default' : 'secondary'}>{rule.status}</Badge>
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

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1">
          <Label>Break threshold (minutes)</Label>
          <Input
            type="number"
            min={0}
            step={15}
            value={configuration.breakThresholdMinutes}
            onChange={(event) => setConfiguration((current) => ({
              ...current,
              breakThresholdMinutes: Number(event.target.value),
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Break deduction (minutes)</Label>
          <Input
            type="number"
            min={0}
            step={15}
            value={configuration.breakDeductionMinutes}
            onChange={(event) => setConfiguration((current) => ({
              ...current,
              breakDeductionMinutes: Number(event.target.value),
            }))}
          />
        </div>
        <div className="space-y-1">
          <Label>Bank holiday</Label>
          <Select
            value={configuration.bankHolidayTreatment}
            onValueChange={(value: PayrollTreatment) => setConfiguration((current) => ({
              ...current,
              bankHolidayTreatment: value,
            }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Night Shift</Label>
          <Select
            value={configuration.nightShiftTreatment || 'none'}
            onValueChange={(value) => setConfiguration((current) => ({
              ...current,
              nightShiftTreatment: value === 'none' ? null : value as PayrollTreatment,
            }))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">No premium</SelectItem>
              {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[680px] space-y-2">
          {DAY_NAMES.map((name, index) => {
            const day = index + 1;
            const band = configuration.dayBands[day];
            return (
              <div key={name} className="grid grid-cols-[120px_1fr_150px_1fr] items-center gap-2">
                <span className="text-sm font-medium">{name}</span>
                <Select value={band.treatment} onValueChange={(value: PayrollTreatment) => updateBand(day, { treatment: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
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
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {TREATMENTS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </div>
      </div>

      <Button onClick={saveDraft} disabled={saving}>
        {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
        Save {rule.name} draft
      </Button>
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
    <Card className="border-border bg-slate-900/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-white">
          <ShieldCheck className="h-5 w-5 text-avs-yellow" />
          Timesheet Payroll Rules
        </CardTitle>
        <CardDescription>
          Version, test and activate the signed Transport, Civils, Plant and Others payroll rules.
          Activated versions and approved calculations are immutable.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading payroll configuration…</div>}
        {!loading && !matrix && <p className="text-sm text-destructive">Payroll configuration could not be loaded.</p>}
        {matrix && (
          <>
            <div className="space-y-4">
              {matrix.rules.map((rule) => <RuleEditor key={rule.id} rule={rule} onSaved={setMatrix} />)}
            </div>

            <div className="space-y-4 rounded-lg border border-border bg-background/60 p-4">
              <div>
                <h4 className="flex items-center gap-2 font-semibold"><Calculator className="h-4 w-4" />Test calculator</h4>
                <p className="text-sm text-muted-foreground">Validate a draft against a single shift before activation.</p>
              </div>
              <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
                <Select value={testRuleKey} onValueChange={(value: PayrollRuleSetKey) => setTestRuleKey(value)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RULE_KEYS.map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent>
                </Select>
                <Select value={testDay} onValueChange={setTestDay}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{DAY_NAMES.map((name, index) => <SelectItem key={name} value={String(index + 1)}>{name}</SelectItem>)}</SelectContent>
                </Select>
                <Input type="time" step={900} value={testStart} onChange={(event) => setTestStart(event.target.value)} />
                <Input type="time" step={900} value={testFinish} onChange={(event) => setTestFinish(event.target.value)} />
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={testNight} onCheckedChange={(value) => setTestNight(value === true)} />Night Shift</label>
                <label className="flex items-center gap-2 text-sm"><Checkbox checked={testBankHoliday} onCheckedChange={(value) => setTestBankHoliday(value === true)} />Bank holiday</label>
              </div>
              <Button variant="outline" onClick={runTestCalculator}>Run test</Button>
              {testResult && (
                <p className="text-sm text-foreground">
                  Basic {minutesToHours(testResult.basicMinutes).toFixed(2)}h · Overtime {minutesToHours(testResult.overtimeMinutes).toFixed(2)}h · Double Time {minutesToHours(testResult.doubleTimeMinutes).toFixed(2)}h
                </p>
              )}
            </div>

            <div className="space-y-4 rounded-lg border border-avs-yellow/30 bg-avs-yellow/5 p-4">
              <div>
                <h4 className="font-semibold text-foreground">Activation preflight</h4>
                <p className="text-sm text-muted-foreground">
                  Activation is inclusive from the selected Sunday. Earlier weeks retain legacy payroll behaviour.
                </p>
              </div>
              <div className="space-y-1">
                <Label>Effective week ending (Sunday)</Label>
                <Input type="date" value={effectiveWeekEnding} onChange={(event) => setEffectiveWeekEnding(event.target.value)} className="max-w-xs" />
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {matrix.teams.map((team) => {
                  const assignment = teamAssignments.find((item) => item.teamId === team.id);
                  return (
                    <div key={team.id} className="flex items-center justify-between gap-3 rounded border border-border p-3">
                      <span className="text-sm font-medium">{team.name}</span>
                      <Select
                        value={assignment?.ruleSetKey || 'civils'}
                        onValueChange={(value: PayrollRuleSetKey) => setTeamAssignments((current) => [
                          ...current.filter((item) => item.teamId !== team.id),
                          { teamId: team.id, ruleSetKey: value },
                        ])}
                      >
                        <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                        <SelectContent>{RULE_KEYS.map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
              <div className="space-y-2">
                <Label>Profile payroll overrides (minimum three Others)</Label>
                <p className="text-xs text-muted-foreground">
                  Assign any rule set per employee. Existing Transport/Civils/Plant overrides are preserved unless cleared.
                </p>
                <Input placeholder="Search employees…" value={profileSearch} onChange={(event) => setProfileSearch(event.target.value)} />
                <div className="max-h-56 space-y-1 overflow-y-auto rounded border border-border p-2">
                  {filteredProfiles.map((profile) => {
                    const assignment = profileAssignments.find((item) => item.profileId === profile.id);
                    return (
                      <div key={profile.id} className="flex items-center justify-between gap-2 rounded p-2 text-sm hover:bg-muted/50">
                        <span>{profile.full_name}{profile.employee_id ? ` (${profile.employee_id})` : ''}</span>
                        <Select
                          value={assignment?.ruleSetKey || 'none'}
                          onValueChange={(value: PayrollRuleSetKey | 'none') => setProfileRule(profile.id, value)}
                        >
                          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No override</SelectItem>
                            {RULE_KEYS.map((key) => <SelectItem key={key} value={key}>{key}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    );
                  })}
                </div>
              </div>
              {matrix.rolloutWeekEnding && (
                <p className="text-sm text-muted-foreground">
                  Current rollout: {matrix.rolloutWeekEnding}. Impacted unapproved timesheets: {matrix.impactedUnapprovedTimesheets}.
                </p>
              )}
              <Button onClick={activate} disabled={activating || !effectiveWeekEnding}>
                {activating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {matrix.rolloutWeekEnding ? 'Activate new payroll versions' : 'Activate signed payroll rules'}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
