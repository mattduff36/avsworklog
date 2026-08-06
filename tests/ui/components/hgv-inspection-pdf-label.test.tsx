/** @vitest-environment happy-dom */

import { isValidElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { HgvInspectionPDF } from '@/lib/pdf/hgv-inspection-pdf';

function collectText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }

  if (Array.isArray(node)) {
    return node.map(collectText).join(' ');
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return collectText(node.props.children);
  }

  return '';
}

function renderPdfText(operatorName: string): string {
  return collectText(HgvInspectionPDF({
    inspection: {
      id: 'inspection-12345',
      inspection_date: '2026-08-03',
      current_mileage: 12000,
      inspector_comments: null,
    },
    hgv: {
      reg_number: 'YK24 HGV',
      nickname: 'Friendly Fleet Name',
      hgv_categories: { name: 'Artic' },
    },
    operator: { full_name: operatorName },
    items: [],
  }));
}

describe('HgvInspectionPDF fleet asset label', () => {
  it('does not repeat the nickname when the operator is named', () => {
    const pdfText = renderPdfText('Peter Woodward');

    expect(pdfText).toContain('YK24 HGV');
    expect(pdfText).not.toContain('Friendly Fleet Name');
    expect(pdfText).not.toContain('Nickname:');
  });

  it('keeps the nickname when the operator is unknown', () => {
    const pdfText = renderPdfText('Unknown');

    expect(pdfText).toContain('YK24 HGV (Friendly Fleet Name)');
    expect(pdfText).not.toContain('Nickname:');
  });
});
