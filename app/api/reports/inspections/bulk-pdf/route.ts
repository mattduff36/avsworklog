import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { VanInspectionPDF } from '@/lib/pdf/van-inspection-pdf';
import { PlantInspectionPDF } from '@/lib/pdf/plant-inspection-pdf';
import { HgvInspectionPDF } from '@/lib/pdf/hgv-inspection-pdf';
import type { VanInspection } from '@/types/inspection';
import type { InspectionItem } from '@/types/inspection';
import type { ModuleName } from '@/types/roles';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { createAdminClient } from '@/lib/supabase/admin';
import { getReportHiddenProfileIds } from '@/lib/server/system-accounts';
import { logServerError } from '@/lib/utils/server-error-logger';
import { getReportDateRangeSpanDays } from '@/lib/server/report-date-range';
import {
  formatFleetAssetLabel,
  getFleetAssetLabelContext,
} from '@/lib/utils/fleet-asset-label';
import {
  isAbortError,
  loadInspectionExportManifest,
  loadInspectionExportPartDetails,
  loadInspectionItemsByInspectionId,
  loadPlantDailyHoursByInspectionId,
  throwIfAborted,
  type DailyCheckInspection,
  type HgvInspectionWithRelations,
  type InspectionExportReader,
  type PlantInspectionWithRelations,
  type VanInspectionWithRelations,
} from '@/lib/server/inspection-export-manifest';

const MAX_INSPECTIONS_PER_PDF = 80;

interface BulkPdfCompletePayload {
  type: 'complete';
  data: string;
  fileName: string;
  contentType: string;
}

interface StreamControl {
  closed: boolean;
  signal: AbortSignal;
  abort: () => void;
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function splitIntoChunks<T>(rows: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < rows.length; index += chunkSize) {
    chunks.push(rows.slice(index, index + chunkSize));
  }
  return chunks;
}

function isClosedStreamError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /closed|invalid state/i.test(message);
}

function enqueueJson(
  controller: ReadableStreamDefaultController<Uint8Array>,
  payload: unknown,
  control: StreamControl,
): void {
  if (control.closed || control.signal.aborted) return;
  const bytes = new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
  try {
    controller.enqueue(bytes);
  } catch (error) {
    control.closed = true;
    control.abort();
    if (!isClosedStreamError(error) && !isAbortError(error)) throw error;
  }
}

function asInspectionExportReader(client: Awaited<ReturnType<typeof createClient>>): InspectionExportReader {
  return client as unknown as InspectionExportReader;
}

function getItemDayOfWeek(item: InspectionItem): number {
  return Number((item as unknown as { day_of_week?: number }).day_of_week ?? 1);
}

async function getScopedModuleProfileIds(
  availableModules: ModuleName[],
  scopeContext: Awaited<ReturnType<typeof getReportScopeContext>>
): Promise<Map<ModuleName, Set<string> | null>> {
  const scopedMap = new Map<ModuleName, Set<string> | null>();

  await Promise.all(
    availableModules.map(async (moduleName) => {
      const scopedProfileIds = await getScopedProfileIdsForModule(moduleName, scopeContext);
      scopedMap.set(moduleName, scopedProfileIds);
    })
  );

  return scopedMap;
}

function resolveVanTemplate(inspection: VanInspectionWithRelations, items: InspectionItem[]) {
  return VanInspectionPDF({
    inspection: inspection as unknown as VanInspection,
    items,
    vehicleReg: formatFleetAssetLabel({
      identifier: inspection.vehicle?.reg_number || 'Unknown',
      nickname: inspection.vehicle?.nickname,
      context: getFleetAssetLabelContext(inspection.profile?.full_name),
    }),
    employeeName: inspection.profile?.full_name || undefined,
  });
}

function resolvePlantTemplate(
  inspection: PlantInspectionWithRelations,
  items: InspectionItem[],
  dailyHours: Array<{ day_of_week: number; hours: number | null }>
) {
  const isHired = inspection.is_hired_plant === true;

  return PlantInspectionPDF({
    inspection: {
      id: inspection.id,
      inspection_date: inspection.inspection_date,
      inspection_end_date: inspection.inspection_end_date || inspection.inspection_date,
      current_mileage: inspection.current_mileage || null,
      inspector_comments: inspection.inspector_comments || null,
      signature_data: inspection.signature_data || null,
      signed_at: inspection.signed_at || null,
      job_code: inspection.job_code,
      job_site_address: inspection.job_site_address,
    },
    plant: isHired
      ? {
          plant_id: inspection.hired_plant_id_serial || 'Unknown',
          nickname: inspection.hired_plant_description || null,
          serial_number: null,
          van_categories: null,
          isHired: true,
          hiringCompany: inspection.hired_plant_hiring_company || null,
        }
      : {
          plant_id: inspection.plant?.plant_id || 'Unknown',
          nickname: inspection.plant?.nickname || null,
          serial_number: inspection.plant?.serial_number || null,
          van_categories: inspection.plant?.van_categories || null,
        },
    operator: {
      full_name: inspection.profile?.full_name || 'Unknown',
    },
    items: items.map((item) => ({
      item_number: item.item_number,
      item_description: item.item_description,
      day_of_week: getItemDayOfWeek(item),
      status: item.status === 'defect' ? 'attention' : item.status,
      comments: item.comments || null,
    })),
    dailyHours,
  });
}

function resolveHgvTemplate(inspection: HgvInspectionWithRelations, items: InspectionItem[]) {
  return HgvInspectionPDF({
    inspection: {
      id: inspection.id,
      inspection_date: inspection.inspection_date,
      current_mileage: inspection.current_mileage || null,
      inspector_comments: inspection.inspector_comments || null,
      signature_data: inspection.signature_data || null,
      signed_at: inspection.signed_at || null,
    },
    hgv: {
      reg_number: inspection.hgv?.reg_number || 'Unknown',
      nickname: inspection.hgv?.nickname || null,
      hgv_categories: inspection.hgv?.hgv_categories || null,
    },
    operator: {
      full_name: inspection.profile?.full_name || 'Unknown',
    },
    items: items.map((item) => ({
      item_number: item.item_number,
      item_description: item.item_description,
      day_of_week: getItemDayOfWeek(item),
      status: item.status === 'defect' ? 'attention' : item.status,
      comments: item.comments || null,
    })),
  });
}

function resolveInspectionPdfTemplate(
  inspection: DailyCheckInspection,
  items: InspectionItem[],
  dailyHours: Array<{ day_of_week: number; hours: number | null }>
) {
  if (inspection.source === 'plant') {
    return resolvePlantTemplate(inspection, items, dailyHours);
  }
  if (inspection.source === 'hgv') {
    return resolveHgvTemplate(inspection, items);
  }
  return resolveVanTemplate(inspection, items);
}

export async function POST(request: NextRequest) {
  let dateFrom = '';
  let dateTo = '';

  try {
    const body = (await request.json()) as { dateFrom?: string; dateTo?: string };
    dateFrom = body.dateFrom || '';
    dateTo = body.dateTo || '';
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  if (!dateFrom || !dateTo || !isValidIsoDate(dateFrom) || !isValidIsoDate(dateTo)) {
    return NextResponse.json({ error: 'Valid dateFrom and dateTo are required (YYYY-MM-DD)' }, { status: 400 });
  }

  if (dateFrom > dateTo) {
    return NextResponse.json({ error: 'dateFrom cannot be after dateTo' }, { status: 400 });
  }

  const spanDays = getReportDateRangeSpanDays({ dateFrom, dateTo });
  if (spanDays === null || spanDays > 366) {
    return NextResponse.json({ error: 'Date range must be 366 days or fewer' }, { status: 400 });
  }

  const generationAbort = new AbortController();
  const control: StreamControl = { closed: false, signal: generationAbort.signal, abort: () => generationAbort.abort() };
  const abortGeneration = () => generationAbort.abort();
  if (request.signal.aborted) generationAbort.abort();
  else request.signal.addEventListener('abort', abortGeneration, { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const safeEnqueue = (payload: unknown) => enqueueJson(controller, payload, control);
      const safeClose = () => {
        request.signal.removeEventListener('abort', abortGeneration);
        if (control.closed) return;
        control.closed = true;
        try {
          controller.close();
        } catch {
          // Disconnect can close the controller before the generator finishes.
        }
      };

      try {
        throwIfAborted(control.signal);
        const supabase = await createClient();
        throwIfAborted(control.signal);
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();
        throwIfAborted(control.signal);

        if (authError || !user) {
          safeEnqueue({ error: 'Unauthorized' });
          safeClose();
          return;
        }

        const canAccessReports = await canEffectiveRoleAccessModule('reports');
        throwIfAborted(control.signal);
        if (!canAccessReports) {
          safeEnqueue({ error: 'Forbidden - Reports access required' });
          safeClose();
          return;
        }

        const [canAccessVanChecks, canAccessPlantChecks, canAccessHgvChecks] = await Promise.all([
          canEffectiveRoleAccessModule('inspections'),
          canEffectiveRoleAccessModule('plant-inspections'),
          canEffectiveRoleAccessModule('hgv-inspections'),
        ]);
        throwIfAborted(control.signal);

        const availableModules: ModuleName[] = [];
        if (canAccessVanChecks) availableModules.push('inspections');
        if (canAccessPlantChecks) availableModules.push('plant-inspections');
        if (canAccessHgvChecks) availableModules.push('hgv-inspections');

        if (availableModules.length === 0) {
          safeEnqueue({ error: 'Forbidden - Daily Checks access required' });
          safeClose();
          return;
        }

        const scopeContext = await getReportScopeContext();
        throwIfAborted(control.signal);
        const scopedModuleIds = await getScopedModuleProfileIds(availableModules, scopeContext);
        throwIfAborted(control.signal);
        const hasAnyScope = availableModules.some((moduleName) => {
          const scoped = scopedModuleIds.get(moduleName);
          return scoped === null || (scoped?.size ?? 0) > 0;
        });
        if (!hasAnyScope) {
          safeEnqueue({ error: 'No daily checks found in the selected date range' });
          safeClose();
          return;
        }

        const reader = asInspectionExportReader(supabase);
        const hiddenProfileIds = await getReportHiddenProfileIds(createAdminClient());
        throwIfAborted(control.signal);
        const manifest = await loadInspectionExportManifest(reader, {
          dateFrom,
          dateTo,
          availableModules,
          scopedModuleIds,
          hiddenProfileIds,
          signal: control.signal,
        });
        throwIfAborted(control.signal);
        if (manifest.length === 0) {
          safeEnqueue({ error: 'No daily checks found in the selected date range' });
          safeClose();
          return;
        }

        const totalInspections = manifest.length;
        const chunks = splitIntoChunks(manifest, MAX_INSPECTIONS_PER_PDF);
        const numParts = chunks.length;
        safeEnqueue({
          type: 'init',
          total: totalInspections,
          needsZip: totalInspections > MAX_INSPECTIONS_PER_PDF,
          numParts,
        });

        let singlePdfFile: { name: string; buffer: Buffer } | null = null;
        const zip = chunks.length > 1 ? new JSZip() : null;
        let processedCount = 0;

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          throwIfAborted(control.signal);
          const chunk = chunks[chunkIndex];
          const partHiddenProfileIds = await getReportHiddenProfileIds(createAdminClient());
          throwIfAborted(control.signal);
          const details = await loadInspectionExportPartDetails(reader, chunk, {
            dateFrom,
            dateTo,
            availableModules,
            scopedModuleIds,
            hiddenProfileIds: partHiddenProfileIds,
            signal: control.signal,
          });
          throwIfAborted(control.signal);
          const detailIds = details.map((inspection) => inspection.id);
          const plantInspectionIds = details
            .filter((inspection): inspection is PlantInspectionWithRelations => inspection.source === 'plant')
            .map((inspection) => inspection.id);
          const [itemsByInspectionId, plantHoursByInspectionId] = await Promise.all([
            loadInspectionItemsByInspectionId(reader, detailIds, control.signal),
            loadPlantDailyHoursByInspectionId(reader, plantInspectionIds, control.signal),
          ]);
          throwIfAborted(control.signal);

          const mergedPdf = await PDFDocument.create();
          const detailByKey = new Map(details.map((inspection) => [`${inspection.source}:${inspection.id}`, inspection]));
          for (const entry of chunk) {
            throwIfAborted(control.signal);
            const inspection = detailByKey.get(`${entry.source}:${entry.id}`);
            const items = inspection ? itemsByInspectionId.get(inspection.id) || [] : [];
            const dailyHours = inspection ? plantHoursByInspectionId.get(inspection.id) || [] : [];
            processedCount += 1;

            if (!inspection || items.length === 0) {
              safeEnqueue({
                type: 'progress',
                current: processedCount,
                total: totalInspections,
                currentPart: chunkIndex + 1,
                totalParts: numParts,
              });
              continue;
            }

            const pdfComponent = resolveInspectionPdfTemplate(inspection, items, dailyHours);
            const pdfBuffer = await renderToBuffer(pdfComponent);
            throwIfAborted(control.signal);
            const singlePdf = await PDFDocument.load(pdfBuffer);
            const pages = await mergedPdf.copyPages(singlePdf, singlePdf.getPageIndices());
            pages.forEach((page) => mergedPdf.addPage(page));
            throwIfAborted(control.signal);

            safeEnqueue({
              type: 'progress',
              current: processedCount,
              total: totalInspections,
              currentPart: chunkIndex + 1,
              totalParts: numParts,
            });
          }

          const mergedPdfBytes = await mergedPdf.save();
          throwIfAborted(control.signal);
          const suffix = chunks.length > 1 ? `_Part${chunkIndex + 1}` : '';
          const file = {
            name: `All_Daily_Checks_${dateFrom}_to_${dateTo}${suffix}.pdf`,
            buffer: Buffer.from(mergedPdfBytes),
          };
          if (zip) {
            zip.file(file.name, file.buffer);
          } else {
            singlePdfFile = file;
          }
        }

        let completePayload: BulkPdfCompletePayload;
        if (singlePdfFile) {
          completePayload = {
            type: 'complete',
            data: singlePdfFile.buffer.toString('base64'),
            fileName: singlePdfFile.name,
            contentType: 'application/pdf',
          };
        } else {
          const zipBuffer = await zip!.generateAsync({ type: 'nodebuffer' });
          throwIfAborted(control.signal);
          completePayload = {
            type: 'complete',
            data: zipBuffer.toString('base64'),
            fileName: `All_Daily_Checks_${dateFrom}_to_${dateTo}.zip`,
            contentType: 'application/zip',
          };
        }

        safeEnqueue(completePayload);
        safeClose();
      } catch (error) {
        if (control.closed || control.signal.aborted || isAbortError(error)) {
          safeClose();
          return;
        }
        console.error('Streaming PDF generation error:', error);
        safeEnqueue({
          error: 'Failed to generate PDFs',
          details: error instanceof Error ? error.message : 'Unknown error',
        });
        safeClose();

        await logServerError({
          error: error as Error,
          request,
          componentName: '/api/reports/inspections/bulk-pdf',
          additionalData: {
            endpoint: '/api/reports/inspections/bulk-pdf',
          },
        });
      }
    },
    cancel() {
      request.signal.removeEventListener('abort', abortGeneration);
      control.closed = true;
      generationAbort.abort();
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
