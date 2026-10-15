import { describe, expect, it } from 'vitest';
import {
  APPROVALS_ID_FILTER_CHUNK_SIZE,
  chunkApprovalsIds,
} from '@/lib/utils/approvals-fetch-batches';

describe('approvals id filter batches', () => {
  it('keeps a short id list in one request', () => {
    const ids = Array.from({ length: APPROVALS_ID_FILTER_CHUNK_SIZE }, (_, index) => `id-${index}`);

    expect(chunkApprovalsIds(ids)).toEqual([ids]);
  });

  it('splits the processed-timesheet volume below the gateway failure size', () => {
    const ids = Array.from({ length: 1461 }, (_, index) => `id-${index}`);
    const chunks = chunkApprovalsIds(ids);

    expect(chunks).toHaveLength(15);
    expect(chunks.every((chunk) => chunk.length <= APPROVALS_ID_FILTER_CHUNK_SIZE)).toBe(true);
    expect(chunks.flat()).toEqual(ids);
  });

  it('drops duplicate ids before splitting', () => {
    expect(chunkApprovalsIds(['a', 'a', 'b'], 1)).toEqual([['a'], ['b']]);
  });
});
