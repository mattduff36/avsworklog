export interface InspectionDefectDescriptor {
  item_number: number | string;
  item_description: string;
}

function normalizeItemDescription(itemDescription: string): string {
  return itemDescription.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function buildInspectionDefectSignature({
  item_number,
  item_description,
}: InspectionDefectDescriptor): string {
  return `${String(item_number).trim()}-${normalizeItemDescription(item_description)}`;
}

export function extractInspectionDefectSignature(description?: string | null): string | null {
  if (!description) {
    return null;
  }

  const match = description.match(/Item\s+(\d+)\s*-\s*([^\n(]+)/i);

  if (!match) {
    return null;
  }

  return buildInspectionDefectSignature({
    item_number: match[1],
    item_description: match[2],
  });
}
