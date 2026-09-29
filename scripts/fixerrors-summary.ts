export type FixerrorsSummaryItem = {
  id: string;
  title: string;
  count: number;
  nextStep: string | null;
};

export type FixerrorsRunSummary = {
  found: FixerrorsSummaryItem[];
  fixedLive: FixerrorsSummaryItem[];
  outstanding: FixerrorsSummaryItem[];
};

function section(title: string, items: FixerrorsSummaryItem[], empty: string): string[] {
  const lines = [title];
  if (items.length === 0) {
    lines.push(`- ${empty}`);
    return lines;
  }
  for (const item of items) {
    const count = `${item.count} occurrence${item.count === 1 ? '' : 's'}`;
    const next = item.nextStep ? ` Next step: ${item.nextStep}` : '';
    lines.push(`- ${item.id}: ${item.title} (${count}).${next}`);
  }
  return lines;
}

export function renderFixerrorsRunSummary(summary: FixerrorsRunSummary): string {
  const recommendation = summary.outstanding.find((item) => item.nextStep)?.nextStep;
  const lines = [
    ...section('Errors found', summary.found, 'none'),
    ...section('Errors fixed live', summary.fixedLive, 'none'),
    ...section('Errors still outstanding', summary.outstanding, 'none'),
    `Outstanding work remains: ${summary.outstanding.length > 0 ? 'YES' : 'NO'}`,
    '',
    `Final recommendation: ${recommendation ?? 'No further fixerrors action is required.'}`,
  ];
  if (recommendation) {
    lines.push('Say "fix" to proceed with this recommendation now.');
  }
  return `${lines.join('\n')}\n`;
}
