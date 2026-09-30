import ExcelJS from 'exceljs';
import { afterEach, describe, expect, it } from 'vitest';
import { generateExcelFile } from '@/lib/utils/excel';

describe('generateExcelFile hyperlinks', () => {
  const previousOrigin = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    if (previousOrigin === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = previousOrigin;
  });

  it('turns authorised root paths into workbook links and leaves other cells as text', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://squires.example';
    const buffer = await generateExcelFile([{
      sheetName: 'Plant',
      columns: [
        { header: 'Job', key: 'job', hyperlink: true },
        { header: 'Evidence', key: 'evidence' },
      ],
      data: [{ job: '/fleet/plant/plant-1/history', evidence: 'submitted plant check' }],
    }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.getWorksheet('Plant');
    expect(sheet?.getCell('A2').value).toEqual({
      text: '/fleet/plant/plant-1/history',
      hyperlink: 'https://squires.example/fleet/plant/plant-1/history',
    });
    expect(sheet?.getCell('B2').value).toBe('submitted plant check');
  });

  it('keeps a plain path when the app origin is not configured', async () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const buffer = await generateExcelFile([{
      sheetName: 'Plant',
      columns: [{ header: 'Job', key: 'job', hyperlink: true }],
      data: [{ job: '/quotes/quote-1' }],
    }]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    expect(workbook.getWorksheet('Plant')?.getCell('A2').value).toBe('/quotes/quote-1');
  });
});