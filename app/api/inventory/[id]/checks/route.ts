import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryManagerAccess } from '@/lib/server/inventory-auth';
import {
  FUTURE_CHECK_CONFIRMATION_REQUIRED,
  isFutureInventoryCheckDate,
  isValidInventoryCheckDate,
} from '@/lib/inventory/check-dates';
import {
  INVENTORY_SERVICE_CHECKLIST_VERSION,
  getInventoryChecklistDefinition,
  getInventoryCheckOverallStatus,
  isInventoryChecklistStatus,
  type InventoryChecklistDefinition,
  type InventoryChecklistItemResult,
} from '@/lib/checklists/inventory-service-checklist';

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface CreateInventoryCheckBody {
  checked_at?: string;
  note?: string | null;
  checklist_version?: string | null;
  checklist_items?: unknown;
  confirm_future_date?: boolean;
  submission_id?: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function getStringValue(value: unknown): string | null {
  return typeof value === 'string' ? value.trim() : null;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateChecklistItems(
  value: unknown,
  definition: InventoryChecklistDefinition,
): { items: InventoryChecklistItemResult[]; error: null } | { items: null; error: string } {
  if (!Array.isArray(value)) {
    return { items: null, error: 'Checklist items must be an array' };
  }

  if (value.length !== definition.items.length) {
    return { items: null, error: 'Checklist is incomplete' };
  }

  const itemsByNumber = new Map<number, Record<string, unknown>>();
  for (const entry of value) {
    if (!isRecord(entry)) {
      return { items: null, error: 'Checklist items must be objects' };
    }

    const itemNumber = entry.item_number;
    if (typeof itemNumber !== 'number' || !Number.isInteger(itemNumber)) {
      return { items: null, error: 'Checklist item numbers are invalid' };
    }

    if (itemsByNumber.has(itemNumber)) {
      return { items: null, error: `Checklist item ${itemNumber} is duplicated` };
    }

    itemsByNumber.set(itemNumber, entry);
  }

  const normalizedItems: InventoryChecklistItemResult[] = [];
  for (const checklistItem of definition.items) {
    const entry = itemsByNumber.get(checklistItem.item_number);
    if (!entry) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} is missing` };
    }

    if (getStringValue(entry.label) !== checklistItem.label) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} has an invalid label` };
    }

    if (!isInventoryChecklistStatus(entry.status)) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} has an invalid status` };
    }

    const comment = getStringValue(entry.comment);
    if (entry.status === 'attention' && !comment) {
      return { items: null, error: `Checklist item ${checklistItem.item_number} requires a fail comment` };
    }

    normalizedItems.push({
      ...checklistItem,
      status: entry.status,
      comment,
    });
  }

  if (itemsByNumber.size !== definition.items.length) {
    return { items: null, error: 'Checklist contains unknown items' };
  }

  return { items: normalizedItems, error: null };
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }
  return '';
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const { id } = await params;
    const body = (await request.json()) as CreateInventoryCheckBody;
    const checkedAt = body.checked_at?.trim() || '';
    if (!isValidInventoryCheckDate(checkedAt)) {
      return NextResponse.json({ error: 'Check date must be a valid YYYY-MM-DD date' }, { status: 400 });
    }

    const confirmFutureDate = body.confirm_future_date === true;
    if (isFutureInventoryCheckDate(checkedAt) && !confirmFutureDate) {
      return NextResponse.json(
        {
          error: 'Confirm the future check date before recording this checklist.',
          code: FUTURE_CHECK_CONFIRMATION_REQUIRED,
        },
        { status: 409 },
      );
    }

    const submissionId = getStringValue(body.submission_id);
    if (submissionId && !isUuid(submissionId)) {
      return NextResponse.json({ error: 'Submission id must be a valid UUID' }, { status: 400 });
    }

    const hasStructuredChecklist = body.checklist_items !== undefined && body.checklist_items !== null;
    let checklistDefinition: InventoryChecklistDefinition | null = null;
    let checklistItems: InventoryChecklistItemResult[] | null = null;

    if (hasStructuredChecklist) {
      const checklistVersion = getStringValue(body.checklist_version) || INVENTORY_SERVICE_CHECKLIST_VERSION;
      checklistDefinition = getInventoryChecklistDefinition(checklistVersion);
      if (!checklistDefinition) {
        return NextResponse.json({ error: 'Unsupported checklist version' }, { status: 400 });
      }

      const checklistValidation = validateChecklistItems(body.checklist_items, checklistDefinition);
      if (checklistValidation.error) {
        return NextResponse.json({ error: checklistValidation.error }, { status: 400 });
      }
      checklistItems = checklistValidation.items;
    }

    const overallStatus =
      checklistItems && checklistDefinition ? getInventoryCheckOverallStatus(checklistItems, checklistDefinition) : null;

    const admin = createAdminClient();
    const { data, error } = await admin.rpc('inventory_record_check', {
      p_item_id: id,
      p_checked_at: checkedAt,
      p_checked_by: access.userId,
      p_note: body.note?.trim() || null,
      p_checklist_version: checklistItems && checklistDefinition ? checklistDefinition.version : null,
      p_checklist_items: checklistItems,
      p_overall_status: overallStatus,
      p_confirm_future_date: confirmFutureDate,
      p_submission_id: submissionId,
    });

    if (error) {
      const message = getErrorMessage(error);
      if (message.includes('Inventory item not found')) {
        return NextResponse.json({ error: 'Inventory item not found' }, { status: 404 });
      }
      if (message.includes('Retired inventory items cannot be checked')) {
        return NextResponse.json({ error: 'Retired inventory items cannot be checked' }, { status: 400 });
      }
      if (message.includes(FUTURE_CHECK_CONFIRMATION_REQUIRED)) {
        return NextResponse.json(
          {
            error: 'Confirm the future check date before recording this checklist.',
            code: FUTURE_CHECK_CONFIRMATION_REQUIRED,
          },
          { status: 409 },
        );
      }
      if (message.includes('Check date must be in YYYY-MM-DD format')) {
        return NextResponse.json({ error: 'Check date must be a valid YYYY-MM-DD date' }, { status: 400 });
      }
      throw error;
    }

    const check = Array.isArray(data) ? data[0] : data;
    if (!check) {
      throw new Error('inventory_record_check returned no check row');
    }

    return NextResponse.json({ check }, { status: 201 });
  } catch (error) {
    console.error('Error recording inventory check:', error);
    return NextResponse.json({ error: 'Failed to record inventory check' }, { status: 500 });
  }
}
