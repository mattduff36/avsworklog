export const APPROVALS_ID_FILTER_CHUNK_SIZE = 100;

export function chunkApprovalsIds(
  ids: readonly string[],
  size = APPROVALS_ID_FILTER_CHUNK_SIZE
): string[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new Error('Approvals id chunk size must be a positive integer');
  }

  const uniqueIds = [...new Set(ids.filter(Boolean))];
  const chunks: string[][] = [];
  for (let index = 0; index < uniqueIds.length; index += size) {
    chunks.push(uniqueIds.slice(index, index + size));
  }
  return chunks;
}
