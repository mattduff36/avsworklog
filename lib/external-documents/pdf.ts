import { PDFDocument } from 'pdf-lib';
import {
  EXTERNAL_DOCUMENT_LIMITS,
  type CombinedExternalDocumentPdf,
  type ExternalDocumentPdfSource,
} from '@/types/external-documents';

const PDF_LOAD_OPTIONS = {
  ignoreEncryption: false,
  updateMetadata: false,
} as const;

const MAX_IMAGE_EDGE = 1600;

export class ExternalDocumentPdfError extends Error {
  readonly status: 400 | 413;

  constructor(message: string, status: 400 | 413 = 400) {
    super(message);
    this.name = 'ExternalDocumentPdfError';
    this.status = status;
  }
}

type ImageKind = 'jpeg' | 'png';
type SourceKind = 'pdf' | ImageKind;

function displayName(name: string): string {
  const cleaned = name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  return cleaned || 'file';
}

export function detectExternalDocumentSourceKind(bytes: Uint8Array): SourceKind | null {
  if (
    bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
  ) {
    return 'pdf';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (
    bytes.length >= 8
    && bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
    && bytes[4] === 0x0d
    && bytes[5] === 0x0a
    && bytes[6] === 0x1a
    && bytes[7] === 0x0a
  ) {
    return 'png';
  }
  return null;
}

function copyBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

function isEncryptedPdfError(error: unknown): boolean {
  return error instanceof Error && (
    error.name === 'EncryptedPDFError' || /encrypted/i.test(error.message)
  );
}

async function loadPdf(bytes: Uint8Array, name: string) {
  try {
    return await PDFDocument.load(copyBytes(bytes), PDF_LOAD_OPTIONS);
  } catch (error) {
    if (isEncryptedPdfError(error)) {
      throw new ExternalDocumentPdfError(
        `${displayName(name)} is encrypted. Remove the password and try again.`,
      );
    }
    throw new ExternalDocumentPdfError(
      `${displayName(name)} could not be read as a PDF. Export it again and retry.`,
    );
  }
}

async function downsizeImage(bytes: Uint8Array, kind: ImageKind): Promise<Uint8Array> {
  if (typeof createImageBitmap !== 'function' || typeof OffscreenCanvas === 'undefined') {
    return bytes;
  }

  try {
    const bitmap = await createImageBitmap(new Blob([copyBytes(bytes)]));
    const largestEdge = Math.max(bitmap.width, bitmap.height);
    const shouldResize = largestEdge > MAX_IMAGE_EDGE || bytes.byteLength > 1_500_000;
    if (!shouldResize || largestEdge < 1) {
      bitmap.close();
      return bytes;
    }

    const scale = Math.min(1, MAX_IMAGE_EDGE / largestEdge);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      bitmap.close();
      return bytes;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const outputType = kind === 'png' ? 'image/png' : 'image/jpeg';
    const quality = kind === 'jpeg' ? 0.82 : undefined;
    const blob = await canvas.convertToBlob({ type: outputType, quality });
    const reduced = new Uint8Array(await blob.arrayBuffer());
    if (reduced.byteLength === 0 || reduced.byteLength >= bytes.byteLength) {
      return bytes;
    }
    if (detectExternalDocumentSourceKind(reduced) !== kind) {
      return bytes;
    }
    return reduced;
  } catch {
    return bytes;
  }
}

function assertOutputSize(byteLength: number) {
  if (byteLength > EXTERNAL_DOCUMENT_LIMITS.maxOutputBytes) {
    throw new ExternalDocumentPdfError(
      'The combined PDF is over the 4 MB upload limit. Remove files or use smaller images and try again.',
      413,
    );
  }
}

export async function inspectExternalDocumentPdf(bytes: Uint8Array, name = 'document.pdf') {
  assertOutputSize(bytes.byteLength);
  if (detectExternalDocumentSourceKind(bytes) !== 'pdf') {
    throw new ExternalDocumentPdfError(`${displayName(name)} is not a PDF.`);
  }
  const document = await loadPdf(bytes, name);
  const pageCount = document.getPageCount();
  if (pageCount < 1 || pageCount > EXTERNAL_DOCUMENT_LIMITS.maxPages) {
    throw new ExternalDocumentPdfError(
      `The PDF must contain between 1 and ${EXTERNAL_DOCUMENT_LIMITS.maxPages} pages.`,
    );
  }
  return { pageCount };
}

export async function combineExternalDocumentSources(
  sources: readonly ExternalDocumentPdfSource[],
): Promise<CombinedExternalDocumentPdf> {
  if (sources.length < 1) {
    throw new ExternalDocumentPdfError('Add at least one PDF, JPEG, or PNG.');
  }
  if (sources.length > EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles) {
    throw new ExternalDocumentPdfError(
      `Choose ${EXTERNAL_DOCUMENT_LIMITS.maxSourceFiles} files or fewer.`,
    );
  }

  const totalBytes = sources.reduce((sum, source) => sum + source.bytes.byteLength, 0);
  if (totalBytes > EXTERNAL_DOCUMENT_LIMITS.maxCombinedInputBytes) {
    throw new ExternalDocumentPdfError('Those files are over the 20 MB combined limit.');
  }

  const merged = await PDFDocument.create();
  for (const source of sources) {
    const name = displayName(source.name);
    if (source.bytes.byteLength < 1) {
      throw new ExternalDocumentPdfError(`${name} is empty.`);
    }
    const kind = detectExternalDocumentSourceKind(source.bytes);
    if (!kind) {
      throw new ExternalDocumentPdfError(`${name} is not a PDF, JPEG, or PNG.`);
    }

    if (kind === 'pdf') {
      const document = await loadPdf(source.bytes, source.name);
      const pageCount = document.getPageCount();
      if (pageCount < 1) {
        throw new ExternalDocumentPdfError(`${name} does not contain any pages.`);
      }
      if (merged.getPageCount() + pageCount > EXTERNAL_DOCUMENT_LIMITS.maxPages) {
        throw new ExternalDocumentPdfError(
          `The combined document is over ${EXTERNAL_DOCUMENT_LIMITS.maxPages} pages.`,
        );
      }
      const pages = await merged.copyPages(document, document.getPageIndices());
      for (const page of pages) {
        merged.addPage(page);
      }
      continue;
    }

    if (merged.getPageCount() + 1 > EXTERNAL_DOCUMENT_LIMITS.maxPages) {
      throw new ExternalDocumentPdfError(
        `The combined document is over ${EXTERNAL_DOCUMENT_LIMITS.maxPages} pages.`,
      );
    }
    const imageBytes = await downsizeImage(source.bytes, kind);
    const imageKind = detectExternalDocumentSourceKind(imageBytes);
    try {
      const image = imageKind === 'jpeg'
        ? await merged.embedJpg(imageBytes)
        : await merged.embedPng(imageBytes);
      const page = merged.addPage([image.width, image.height]);
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: image.width,
        height: image.height,
      });
    } catch {
      throw new ExternalDocumentPdfError(`${name} could not be read. Use a standard JPEG or PNG.`);
    }
  }

  const bytes = await merged.save();
  assertOutputSize(bytes.byteLength);
  return {
    bytes,
    pageCount: merged.getPageCount(),
    fileName: 'combined.pdf',
  };
}

export async function readExternalDocumentSource(file: File): Promise<ExternalDocumentPdfSource> {
  return {
    name: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  };
}
