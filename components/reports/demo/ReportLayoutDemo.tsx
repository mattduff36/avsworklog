'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, ChevronRight, FileSpreadsheet, SlidersHorizontal, X } from 'lucide-react';
import { AppPageHeader, AppPageShell } from '@/components/layout/AppPageShell';
import { AppPageLoadingShell } from '@/components/layout/AppPageLoadingShell';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchInput } from '@/components/ui/search-input';
import { usePermissionCheck } from '@/lib/hooks/usePermissionCheck';
import { demoModules, demoReports, type DemoModuleId, type DemoReport } from './report-demo-data';
import s from './report-layout-demo.module.css';

type Layout = 'library' | 'overview' | 'guided';
const layouts: { id: Layout; title: string; description: string }[] = [
  { id: 'library', title: 'Report library', description: 'Browse, select, then prepare your report.' },
  { id: 'overview', title: 'Module overview', description: 'Find the right report in its familiar module.' },
  { id: 'guided', title: 'Guided builder', description: 'One decision at a time, from module to report.' },
];
const tint = (colour: string): CSSProperties => ({ '--module-colour': colour } as CSSProperties);

export function ReportLayoutDemo({ layout }: { layout: Layout }) {
  const { hasPermission, loading } = usePermissionCheck('reports');
  const [moduleId, setModuleId] = useState<DemoModuleId>('timesheets');
  const [reportId, setReportId] = useState('weekly');
  const [query, setQuery] = useState('');
  const [from, setFrom] = useState('2026-10-19');
  const [to, setTo] = useState('2026-10-25');
  const [step, setStep] = useState(1);
  const [openReport, setOpenReport] = useState(false);
  const [preview, setPreview] = useState(false);
  const setupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (openReport) setupRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openReport, reportId]);
  const selectedModule = demoModules.find(module => module.id === moduleId)!;
  const report = demoReports.find(item => item.id === reportId)!;
  const current = layouts.find(item => item.id === layout)!;
  const filtered = demoReports.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(query.toLowerCase()));
  const isSnapshot = report.id === 'allowance';
  const rangeDays = (Date.parse(to) - Date.parse(from)) / 86400000 + 1;
  const limit = report.id === 'plant' ? 62 : report.id === 'labour' ? 366 : null;
  const dateError = !from || (!isSnapshot && !to) ? 'Choose your reporting dates.' : !isSnapshot && from > to ? 'The end date must be on or after the start date.' : !isSnapshot && limit && rangeDays > limit ? `Choose a range of ${limit} days or fewer.` : '';

  function chooseModule(id: DemoModuleId) {
    setModuleId(id); setReportId(demoReports.find(item => item.module === id)!.id); setPreview(false);
  }
  function chooseReport(item: DemoReport) {
    setReportId(item.id); setModuleId(item.module); setPreview(false);
    if (layout === 'overview') setOpenReport(true);
  }
  function exportSample() {
    const content = ['SQUIRES LAYOUT DEMO — SAMPLE DATA ONLY', report.title, `Period: ${from}${isSnapshot ? '' : ` to ${to}`}`, '', report.columns.join(','), ...report.rows.map(row => row.join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `DEMO-${report.id}.csv`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  if (loading) return <AppPageLoadingShell title="Reports" accent="brand" />;
  if (!hasPermission) return null;

  function reportPicker() {
    return <div className={s.reportChoices}>{filtered.filter(item => item.module === moduleId).map(item => <button type="button" key={item.id} className={`${s.reportChoice} ${reportId === item.id ? s.chosenReport : ''}`} aria-pressed={reportId === item.id} onClick={() => chooseReport(item)}>
      <span className={s.formatMark}><FileSpreadsheet size={18} aria-hidden="true" /></span>
      <span><strong>{item.title}</strong><small>{item.description}</small><em>{item.format}</em></span>
      <ChevronRight size={16} aria-hidden="true" />
    </button>)}{!filtered.some(item => item.module === moduleId) && <p className={s.empty}>No matching reports. Try another search.</p>}</div>;
  }

  function reportDetail() {
    return <div className={s.detail} style={tint(selectedModule.colour)}>
      <div className={s.detailTitle}>
        <span className={s.moduleLabel}><selectedModule.icon size={16} aria-hidden="true" />{selectedModule.name}</span>
        <h2>{report.title}</h2><p>{report.description}</p>
      </div>
      <div className={s.period}>
        <div className={s.controlHeading}><h3>{isSnapshot ? 'Snapshot date' : 'Reporting period'}</h3><span>{report.format}</span></div>
        <div className={s.dateFields}>
          <div><Label htmlFor={`${layout}-from`}>{isSnapshot ? 'As at' : 'From'}</Label><Input id={`${layout}-from`} type="date" value={from} onChange={e => { setFrom(e.target.value); setPreview(false); }} /></div>
          {!isSnapshot && <div><Label htmlFor={`${layout}-to`}>To</Label><Input id={`${layout}-to`} type="date" value={to} onChange={e => { setTo(e.target.value); setPreview(false); }} /></div>}
        </div>
        <p className={s.note}>{report.note}</p>
        {report.id === 'labour' && <div className={s.labourOptions}><Label htmlFor={`${layout}-jobs`}>Job codes (optional)</Label><Input id={`${layout}-jobs`} placeholder="e.g. DEMO-01" /><small>Demo controls only; sample figures do not change.</small></div>}
        {dateError && <p role="alert" className={s.error}>{dateError}</p>}
        <Button className={s.primary} disabled={Boolean(dateError)} onClick={() => setPreview(true)}>Preview sample <ArrowRight size={16} /></Button>
      </div>
      {preview ? <div className={s.preview} aria-live="polite"><div className={s.previewHeading}><h3>Sample preview</h3><span>Illustrative data</span></div><div className={s.tableScroll}><table><thead><tr>{report.columns.map(column => <th key={column}>{column}</th>)}</tr></thead><tbody>{report.rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div><button type="button" className={s.quietExport} onClick={exportSample}><ArrowDownToLine size={15} /> Download sample CSV</button></div> : <div className={s.previewHint}><FileSpreadsheet size={24} strokeWidth={1.3} /><p>Your report preview appears here.</p><small>This demo uses illustrative data only.</small></div>}
    </div>;
  }

  return <AppPageShell width="wide" className={s.demo}>
    <div className={s.comparison}><span><strong>Layout previews</strong><small>Demo only · no live report data</small></span><nav aria-label="Compare report layouts">{layouts.map((item, index) => <Link key={item.id} href={`/reports/demo/${item.id}`} aria-current={layout === item.id ? 'page' : undefined}><span>{index + 1}</span>{item.title}</Link>)}</nav></div>
    <AppPageHeader title="Reports" description={current.description} titleMeta={<span className={s.demoBadge}>Demo {layouts.indexOf(current) + 1}</span>} />

    {layout === 'library' && <div className={s.library}>
      <aside className={s.moduleRail}><h2>Modules</h2><nav aria-label="Report modules">{demoModules.map(module => <button key={module.id} type="button" style={tint(module.colour)} className={moduleId === module.id ? s.activeModule : ''} aria-pressed={moduleId === module.id} onClick={() => chooseModule(module.id)}><module.icon size={19} /><span>{module.name}</span><small>{demoReports.filter(item => item.module === module.id).length}</small></button>)}</nav><p>Choose a module to browse its reports.</p></aside>
      <section className={s.libraryList} style={tint(selectedModule.colour)}><div className={s.listHeading}><span className={s.moduleLabel}>{selectedModule.description}</span><h2>{selectedModule.name}</h2><SearchInput aria-label="Search reports in this module" placeholder="Find a report…" value={query} onChange={e => setQuery(e.target.value)} /></div>{reportPicker()}</section>
      <section className={s.libraryDetail} aria-label="Selected report">{reportDetail()}</section>
    </div>}

    {layout === 'overview' && <>
      <div className={s.overviewIntro}><div><h2>What would you like to report on?</h2><p>Start with a module. Open a report when you’re ready.</p></div><SearchInput aria-label="Find a report" placeholder="Search all 11 reports…" value={query} onChange={e => setQuery(e.target.value)} containerClassName={s.overviewSearch} /></div>
      <div className={s.overview}>{demoModules.map(module => { const reports = filtered.filter(item => item.module === module.id); if (!reports.length) return null; return <section key={module.id} className={s.moduleSection} style={tint(module.colour)}>
        <div className={s.moduleIdentity}><module.icon size={30} strokeWidth={1.4} aria-hidden="true" /><h2>{module.name}</h2><p>{module.short}</p><small>{reports.length} {reports.length === 1 ? 'report' : 'reports'}</small></div>
        <div className={s.moduleReportList}>{reports.map(item => <button type="button" key={item.id} onClick={() => chooseReport(item)}><span><strong>{item.title}</strong><small>{item.description}</small></span><em>{item.format}</em><ArrowRight size={18} aria-hidden="true" /></button>)}</div>
      </section>; })}{!filtered.length && <p className={s.empty}>No matching reports. Try a different search.</p>}</div>
      {openReport && <div ref={setupRef} className={s.inlineDetail} id="report-setup"><div className={s.inlineDetailBar}><span><SlidersHorizontal size={16} /> Report setup</span><button type="button" aria-label="Close report setup" onClick={() => setOpenReport(false)}><X size={18} /></button></div>{reportDetail()}</div>}
    </>}

    {layout === 'guided' && <div className={s.guided}>
      <aside className={s.steps}><h2>Build your report</h2><p>Choose what you need.<br />We’ll keep the rest out of the way.</p><ol>{['Choose a module', 'Choose a report', 'Set dates & preview'].map((label, index) => <li key={label} className={step === index + 1 ? s.currentStep : ''}><button type="button" disabled={index + 1 > step} onClick={() => { setStep(index + 1); setPreview(false); }}><span>{step > index + 1 ? <Check size={16} /> : index + 1}</span><strong>{label}</strong></button></li>)}</ol><div className={s.selectionSummary}><small>YOUR SELECTION</small><span style={{ color: selectedModule.colour }}>{selectedModule.name}</span>{step > 1 && <strong>{report.title}</strong>}</div></aside>
      <section className={s.stepContent}>
        {step === 1 && <><div className={s.stepHeading}><span>Step 1 of 3</span><h2>Which part of the business?</h2><p>Each module brings its relevant reports together.</p></div><div className={s.moduleOptions}>{demoModules.map(module => <button key={module.id} type="button" style={tint(module.colour)} aria-pressed={moduleId === module.id} className={moduleId === module.id ? s.selectedOption : ''} onClick={() => chooseModule(module.id)}><module.icon size={24} /><span><strong>{module.name}</strong><small>{module.description}</small></span><span className={s.radio}>{moduleId === module.id && <Check size={13} />}</span></button>)}</div><div className={s.stepFooter}><span>{demoReports.filter(item => item.module === moduleId).length} reports available</span><Button className={s.primary} onClick={() => setStep(2)}>Choose report <ArrowRight size={16} /></Button></div></>}
        {step === 2 && <><div className={s.stepHeading}><span>Step 2 of 3</span><h2 style={{ color: selectedModule.colour }}>{selectedModule.name}</h2><p>Pick the report that answers your question.</p></div>{reportPicker()}<div className={s.stepFooter}><Button variant="ghost" onClick={() => setStep(1)}><ArrowLeft size={16} /> Back</Button><Button className={s.primary} onClick={() => setStep(3)}>Set report dates <ArrowRight size={16} /></Button></div></>}
        {step === 3 && <><Button variant="ghost" className={s.back} onClick={() => { setStep(2); setPreview(false); }}><ArrowLeft size={16} /> Change report</Button>{reportDetail()}</>}
      </section>
    </div>}
    <p className={s.demoFootnote}>Interactive layout demo. Preview any report using sample data; no real reports are generated and no settings are saved.</p>
  </AppPageShell>;
}
