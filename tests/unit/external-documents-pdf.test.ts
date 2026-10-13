import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { ExternalDocumentPdfError, combineExternalDocumentSources, inspectExternalDocumentPdf } from '@/lib/external-documents/pdf';
import { EXTERNAL_DOCUMENT_LIMITS } from '@/types/external-documents';

const PNG_1X1 = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
));

const JPEG_1X1 = Uint8Array.from(Buffer.from(
  'ffd8ffe000104a46494600010101004800480000ffdb004300030202020202030202020303030304060404040404080606050609080a0a090809090a0c0f0c0a0b0e0b09090d110d0e0f101011100a0c12131210130f101010ffc9000b080001000101011100ffcc000600101000ffda00080001000100003f00fbffd9',
  'hex',
));

async function pdfPages(width: number, height: number, count = 1): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  for (let index = 0; index < count; index += 1) document.addPage([width, height]);
  return document.save();
}

async function pageSize(bytes: Uint8Array, index: number) {
  const document = await PDFDocument.load(bytes);
  const page = document.getPage(index);
  return { width: page.getWidth(), height: page.getHeight(), count: document.getPageCount() };
}

describe('combineExternalDocumentSources', () => {
  it('keeps mixed PDF and image order', async () => {
    const first = await pdfPages(320, 140);
    const second = await pdfPages(180, 90);
    const combined = await combineExternalDocumentSources([
      { name: 'photo.png', bytes: PNG_1X1 },
      { name: 'wide.pdf', bytes: first },
      { name: 'scan.jpg', bytes: JPEG_1X1 },
      { name: 'narrow.pdf', bytes: second },
    ]);

    expect(combined.fileName).toBe('combined.pdf');
    expect(combined.pageCount).toBe(4);
    await expect(pageSize(combined.bytes, 0)).resolves.toMatchObject({ width: 1, height: 1 });
    await expect(pageSize(combined.bytes, 1)).resolves.toMatchObject({ width: 320, height: 140 });
    await expect(pageSize(combined.bytes, 2)).resolves.toMatchObject({ width: 1, height: 1 });
    await expect(pageSize(combined.bytes, 3)).resolves.toMatchObject({ width: 180, height: 90 });
  });

  it('rejects empty, invalid, and oversized input', async () => {
    await expect(combineExternalDocumentSources([])).rejects.toBeInstanceOf(ExternalDocumentPdfError);
    await expect(combineExternalDocumentSources([{ name: 'blank.pdf', bytes: new Uint8Array() }])).rejects.toThrow(/empty/i);
    await expect(combineExternalDocumentSources([{ name: 'notes.txt', bytes: Uint8Array.from([1, 2, 3, 4]) }])).rejects.toThrow(/not a PDF, JPEG, or PNG/i);

    const brokenPdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await expect(combineExternalDocumentSources([{ name: 'broken.pdf', bytes: brokenPdf }])).rejects.toThrow(/could not be read as a PDF/i);

    const tooBig = new Uint8Array(EXTERNAL_DOCUMENT_LIMITS.maxCombinedInputBytes + 1);
    tooBig.set([0x25, 0x50, 0x44, 0x46], 0);
    await expect(combineExternalDocumentSources([{ name: 'large.pdf', bytes: tooBig }])).rejects.toThrow(/20 MB/);

    const sources = await Promise.all(Array.from({ length: EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles + 1 }, async (_unused, index) => ({
      name: `page-${index}.pdf`,
      bytes: await pdfPages(40, 40),
    })));
    await expect(combineExternalDocumentSources(sources)).rejects.toThrow(/20 files or fewer|files or fewer/i);
  });

  it('rejects documents over the page limit', async () => {
    const bytes = await pdfPages(40, 40, EXTERNAL_DOCUMENT_LIMITS.maxPages + 1);
    await expect(combineExternalDocumentSources([{ name: 'long.pdf', bytes }])).rejects.toThrow(/200 pages/);
  });
});

describe('inspectExternalDocumentPdf', () => {
  it('rejects a payload over the output size before treating it as readable', async () => {
    const bytes = new Uint8Array(EXTERNAL_DOCUMENT_LIMITS.maxOutputBytes + 1);
    bytes.set([0x25, 0x50, 0x44, 0x46], 0);
    await expect(inspectExternalDocumentPdf(bytes)).rejects.toThrow(/4 MB/);
  });

  it('counts pages in a readable PDF', async () => {
    const bytes = await pdfPages(80, 80, 2);
    await expect(inspectExternalDocumentPdf(bytes, 'two.pdf')).resolves.toEqual({ pageCount: 2 });
  });
});
