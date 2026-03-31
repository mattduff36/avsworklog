import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { PDFDocument } from 'pdf-lib';
import JSZip from 'jszip';
import { InspectionPDF } from '@/lib/pdf/inspection-pdf';
import { VanInspectionPDF } from '@/lib/pdf/van-inspection-pdf';
import { PlantInspectionPDF } from '@/lib/pdf/plant-inspection-pdf';
import { HgvInspectionPDF } from '@/lib/pdf/hgv-inspection-pdf';
import { isVanCategory } from '@/lib/checklists/vehicle-checklists';
import { getVehicleCategoryName } from '@/lib/utils/deprecation-logger';
import type { VanInspection } from '@/types/inspection';
import type { InspectionItem } from '@/types/inspection';
import type { ModuleName } from '@/types/roles';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getReportScopeContext, getScopedProfileIdsForModule } from '@/lib/server/report-scope';
import { logServerError } from '@/lib/utils/server-error-logger';

const MAX_INSPECTIONS_PER_PDF = 80;

interface ProfileShape {
  full_name?: string | null;
}

interface VanVehicleShape {
  reg_number?: string | null;
  vehicle_type?: string | null;
  van_categories?: { name: string } | null;
}

interface PlantShape {
  plant_id?: string | null;
  nickname?: string | null;
  serial_number?: string | null;
  van_categories?: { name: string } | null;
}

interface HgvShape {
  reg_number?: string | null;
  nickname?: string | null;
  hgv_categories?: { name: string } | null;
}

interface BaseInspectionShape {
  id: string;
  user_id: string;
  inspection_date: string;
  inspection_end_date?: string | null;
  current_mileage?: number | null;
  status: string;
  inspector_comments?: string | null;
  signature_data?: string | null;
  signed_at?: string | null;
}

interface VanInspectionWithRelations extends BaseInspectionShape {
  source: 'van';
  vehicle?: VanVehicleShape | null;
  profile?: ProfileShape | null;
}

interface PlantInspectionWithRelations extends BaseInspectionShape {
  source: 'plant';
  plant?: PlantShape | null;
  profile?: ProfileShape | null;
  is_hired_plant?: boolean | null;
  hired_plant_id_serial?: string | null;
  hired_plant_description?: string | null;
  hired_plant_hiring_company?: string | null;
}

interface HgvInspectionWithRelations extends BaseInspectionShape {
  source: 'hgv';
  hgv?: HgvShape | null;
  profile?: ProfileShape | null;
}

type DailyCheckInspection = VanInspectionWithRelations | PlantInspectionWithRelations | HgvInspectionWithRelations;

interface BulkPdfCompletePayload {
  type: 'complete';
  data: string;
  fileName: string;
  contentType: string;
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

function enqueueJson(controller: ReadableStreamDefaultController<Uint8Array>, payload: unknown): void {
  const encoder = new TextEncoder();
  controller.enqueue(encoder.encode(`${JSON.stringify(payload)}\n`));
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
  const vehicleType = getVehicleCategoryName({
    van_categories: inspection.vehicle?.van_categories ?? null,
    vehicle_type: inspection.vehicle?.vehicle_type ?? null,
  });
  const useVanTemplate = isVanCategory(vehicleType);

  return useVanTemplate
    ? VanInspectionPDF({
        inspection: inspection as unknown as VanInspection,
        items,
        vehicleReg: inspection.vehicle?.reg_number || undefined,
        employeeName: inspection.profile?.full_name || undefined,
      })
    : InspectionPDF({
        inspection: inspection as unknown as VanInspection,
        items,
        vehicleReg: inspection.vehicle?.reg_number || undefined,
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
      status: item.status,
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
      status: item.status,
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

async function fetchInspectionItems(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inspectionId: string
): Promise<InspectionItem[]> {
  const { data, error } = await supabase
    .from('inspection_items')
    .select('*')
    .eq('inspection_id', inspectionId)
    .order('item_number', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as InspectionItem[];
}

async function fetchPlantDailyHours(
  supabase: Awaited<ReturnType<typeof createClient>>,
  inspectionId: string
): Promise<Array<{ day_of_week: number; hours: number | null }>> {
  const { data, error } = await supabase
    .from('inspection_daily_hours')
    .select('day_of_week, hours')
    .eq('inspection_id', inspectionId)
    .order('day_of_week', { ascending: true });

  if (error) {
    throw error;
  }

  return (data || []) as Array<{ day_of_week: number; hours: number | null }>;
}

async function fetchScopedInspections(
  supabase: Awaited<ReturnType<typeof createClient>>,
  dateFrom: string,
  dateTo: string,
  availableModules: ModuleName[],
  scopedModuleIds: Map<ModuleName, Set<string> | null>
): Promise<DailyCheckInspection[]> {
  const canAccessVanChecks = availableModules.includes('inspections');
  const canAccessPlantChecks = availableModules.includes('plant-inspections');
  const canAccessHgvChecks = availableModules.includes('hgv-inspections');

  const vanScope = scopedModuleIds.get('inspections') || null;
  const plantScope = scopedModuleIds.get('plant-inspections') || null;
  const hgvScope = scopedModuleIds.get('hgv-inspections') || null;

  const [vanResult, plantResult, hgvResult] = await Promise.all([
    canAccessVanChecks && (!vanScope || vanScope.size > 0)
      ? (async () => {
          let query = supabase
            .from('van_inspections')
            .select(`
              id,
              user_id,
              inspection_date,
              inspection_end_date,
              current_mileage,
              status,
              inspector_comments,
              signature_data,
              signed_at,
              vehicle:vans(
                reg_number,
                vehicle_type,
                van_categories(name)
              ),
              profile:profiles!van_inspections_user_id_fkey(full_name)
            `)
            .neq('status', 'draft')
            .gte('inspection_date', dateFrom)
            .lte('inspection_date', dateTo)
            .order('inspection_date', { ascending: true });

          if (vanScope) {
            query = query.in('user_id', Array.from(vanScope));
          }
          return query;
        })()
      : Promise.resolve({ data: [], error: null }),
    canAccessPlantChecks && (!plantScope || plantScope.size > 0)
      ? (async () => {
          let query = supabase
            .from('plant_inspections')
            .select(`
              id,
              user_id,
              inspection_date,
              inspection_end_date,
              current_mileage,
              status,
              inspector_comments,
              signature_data,
              signed_at,
              is_hired_plant,
              hired_plant_id_serial,
              hired_plant_description,
              hired_plant_hiring_company,
              plant(
                plant_id,
                nickname,
                serial_number,
                van_categories(name)
              ),
              profile:profiles!plant_inspections_user_id_fkey(full_name)
            `)
            .neq('status', 'draft')
            .gte('inspection_date', dateFrom)
            .lte('inspection_date', dateTo)
            .order('inspection_date', { ascending: true });

          if (plantScope) {
            query = query.in('user_id', Array.from(plantScope));
          }
          return query;
        })()
      : Promise.resolve({ data: [], error: null }),
    canAccessHgvChecks && (!hgvScope || hgvScope.size > 0)
      ? (async () => {
          let query = supabase
            .from('hgv_inspections')
            .select(`
              id,
              user_id,
              inspection_date,
              inspection_end_date,
              current_mileage,
              status,
              inspector_comments,
              signature_data,
              signed_at,
              hgv:hgvs!hgv_inspections_hgv_id_fkey(
                reg_number,
                nickname,
                hgv_categories(name)
              ),
              profile:profiles!hgv_inspections_user_id_fkey(full_name)
            `)
            .neq('status', 'draft')
            .gte('inspection_date', dateFrom)
            .lte('inspection_date', dateTo)
            .order('inspection_date', { ascending: true });

          if (hgvScope) {
            query = query.in('user_id', Array.from(hgvScope));
          }
          return query;
        })()
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (vanResult.error) {
    throw vanResult.error;
  }
  if (plantResult.error) {
    throw plantResult.error;
  }
  if (hgvResult.error) {
    throw hgvResult.error;
  }

  const combined: DailyCheckInspection[] = [
    ...((vanResult.data || []) as Omit<VanInspectionWithRelations, 'source'>[]).map((row) => ({
      ...row,
      source: 'van' as const,
    })),
    ...((plantResult.data || []) as Omit<PlantInspectionWithRelations, 'source'>[]).map((row) => ({
      ...row,
      source: 'plant' as const,
    })),
    ...((hgvResult.data || []) as Omit<HgvInspectionWithRelations, 'source'>[]).map((row) => ({
      ...row,
      source: 'hgv' as const,
    })),
  ];

  combined.sort((a, b) => a.inspection_date.localeCompare(b.inspection_date));
  return combined;
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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const supabase = await createClient();
        const {
          data: { user },
          error: authError,
        } = await supabase.auth.getUser();

        if (authError || !user) {
          enqueueJson(controller, { error: 'Unauthorized' });
          controller.close();
          return;
        }

        const canAccessReports = await canEffectiveRoleAccessModule('reports');
        if (!canAccessReports) {
          enqueueJson(controller, { error: 'Forbidden - Reports access required' });
          controller.close();
          return;
        }

        const [canAccessVanChecks, canAccessPlantChecks, canAccessHgvChecks] = await Promise.all([
          canEffectiveRoleAccessModule('inspections'),
          canEffectiveRoleAccessModule('plant-inspections'),
          canEffectiveRoleAccessModule('hgv-inspections'),
        ]);

        const availableModules: ModuleName[] = [];
        if (canAccessVanChecks) availableModules.push('inspections');
        if (canAccessPlantChecks) availableModules.push('plant-inspections');
        if (canAccessHgvChecks) availableModules.push('hgv-inspections');

        if (availableModules.length === 0) {
          enqueueJson(controller, { error: 'Forbidden - Daily Checks access required' });
          controller.close();
          return;
        }

        const scopeContext = await getReportScopeContext();
        const scopedModuleIds = await getScopedModuleProfileIds(availableModules, scopeContext);
        const hasAnyScope = availableModules.some((moduleName) => {
          const scoped = scopedModuleIds.get(moduleName);
          return scoped === null || (scoped?.size ?? 0) > 0;
        });
        if (!hasAnyScope) {
          enqueueJson(controller, { error: 'No daily checks found in the selected date range' });
          controller.close();
          return;
        }

        const inspections = await fetchScopedInspections(supabase, dateFrom, dateTo, availableModules, scopedModuleIds);
        if (inspections.length === 0) {
          enqueueJson(controller, { error: 'No daily checks found in the selected date range' });
          controller.close();
          return;
        }

        const totalInspections = inspections.length;
        const chunks = splitIntoChunks(inspections, MAX_INSPECTIONS_PER_PDF);
        const numParts = chunks.length;
        enqueueJson(controller, {
          type: 'init',
          total: totalInspections,
          needsZip: totalInspections > MAX_INSPECTIONS_PER_PDF,
          numParts,
        });

        const pdfBuffers: Array<{ name: string; buffer: Buffer }> = [];
        let processedCount = 0;

        for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
          const chunk = chunks[chunkIndex];
          const mergedPdf = await PDFDocument.create();

          for (const inspection of chunk) {
            let items: InspectionItem[] = [];
            let dailyHours: Array<{ day_of_week: number; hours: number | null }> = [];

            try {
              items = await fetchInspectionItems(supabase, inspection.id);
              if (inspection.source === 'plant') {
                dailyHours = await fetchPlantDailyHours(supabase, inspection.id);
              }
            } catch (error) {
              console.error(`Failed to fetch data for daily check ${inspection.id}:`, error);
            }

            processedCount += 1;
            if (items.length === 0) {
              enqueueJson(controller, {
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
            const singlePdf = await PDFDocument.load(pdfBuffer);
            const pages = await mergedPdf.copyPages(singlePdf, singlePdf.getPageIndices());
            pages.forEach((page) => mergedPdf.addPage(page));

            enqueueJson(controller, {
              type: 'progress',
              current: processedCount,
              total: totalInspections,
              currentPart: chunkIndex + 1,
              totalParts: numParts,
            });
          }

          const mergedPdfBytes = await mergedPdf.save();
          const suffix = chunks.length > 1 ? `_Part${chunkIndex + 1}` : '';
          pdfBuffers.push({
            name: `All_Daily_Checks_${dateFrom}_to_${dateTo}${suffix}.pdf`,
            buffer: Buffer.from(mergedPdfBytes),
          });
        }

        let completePayload: BulkPdfCompletePayload;
        if (pdfBuffers.length === 1) {
          completePayload = {
            type: 'complete',
            data: pdfBuffers[0].buffer.toString('base64'),
            fileName: pdfBuffers[0].name,
            contentType: 'application/pdf',
          };
        } else {
          const zip = new JSZip();
          pdfBuffers.forEach((file) => zip.file(file.name, file.buffer));
          const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
          completePayload = {
            type: 'complete',
            data: zipBuffer.toString('base64'),
            fileName: `All_Daily_Checks_${dateFrom}_to_${dateTo}.zip`,
            contentType: 'application/zip',
          };
        }

        enqueueJson(controller, completePayload);
        controller.close();
      } catch (error) {
        console.error('Streaming PDF generation error:', error);
        enqueueJson(controller, {
          error: 'Failed to generate PDFs',
          details: error instanceof Error ? error.message : 'Unknown error',
        });
        controller.close();

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
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
