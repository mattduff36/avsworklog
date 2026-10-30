import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TRAINING_LISTS,
  TRAINING_SUMMARY_PATH,
  clearTrainingLoads,
  fetchTrainingCollection,
  invalidateTrainingCollections,
  isCurrentTrainingRead,
  resetTrainingLoaderState,
  splitTrainingRefresh,
  trainingCollectionEpoch,
  trainingScopeKey,
} from '@/lib/client/training-data-loader';

const allowedScope = { userId: 'user-1', allowed: true, viewAsKey: 'self' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const summaryBody = {
  summary: {
    totalRecords: 4,
    activeRecords: 3,
    archivedRecords: 1,
    expiredRecords: 1,
    expiringSoonRecords: 0,
    noExpiryRecords: 1,
    needsNvqRecords: 0,
    awaitingCardRecords: 0,
    trainingBookedRecords: 0,
    manualReviewRecords: 0,
    unlinkedPeople: 2,
  },
};

describe('training data loader', () => {
  beforeEach(() => {
    resetTrainingLoaderState();
    vi.unstubAllGlobals();
  });

  it('loads the summary without requesting tab collections', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(summaryBody));
    vi.stubGlobal('fetch', fetchMock);

    const read = await fetchTrainingCollection<typeof summaryBody.summary>(allowedScope, 'summary');

    expect(read.data.activeRecords).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(TRAINING_SUMMARY_PATH, { cache: 'no-store' });
    expect(isCurrentTrainingRead(read, trainingCollectionEpoch('summary'), trainingScopeKey(allowedScope))).toBe(true);
  });

  it('does not request training data when the scope is denied', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTrainingCollection({ userId: 'user-1', allowed: false, viewAsKey: 'self' }, 'notes'))
      .rejects.toMatchObject({ status: 403 });
    await expect(fetchTrainingCollection({ userId: ' ', allowed: true, viewAsKey: 'self' }, 'records'))
      .rejects.toMatchObject({ status: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads every notes page once and shares an in-flight read', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('offset=0')) {
        return jsonResponse({
          notes: [{ id: 'note-1' }],
          pagination: { offset: 0, limit: 500, has_more: true },
        });
      }
      if (url.includes('offset=500')) {
        return jsonResponse({
          notes: [{ id: 'note-2' }],
          pagination: { offset: 500, limit: 500, has_more: false },
        });
      }
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const [first, second] = await Promise.all([
      fetchTrainingCollection<Array<{ id: string }>>(allowedScope, 'notes'),
      fetchTrainingCollection<Array<{ id: string }>>(allowedScope, 'notes'),
    ]);

    expect(first).toBe(second);
    expect(first.data.map((note) => note.id)).toEqual(['note-1', 'note-2']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(TRAINING_LISTS.notes.path);
  });

  it('retries a failed read instead of reusing the failure', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'Training notes unavailable' }, 503))
      .mockResolvedValueOnce(jsonResponse({
        notes: [{ id: 'note-1' }],
        pagination: { has_more: false },
      }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchTrainingCollection(allowedScope, 'notes')).rejects.toThrow('Training notes unavailable');
    await expect(fetchTrainingCollection<Array<{ id: string }>>(allowedScope, 'notes')).resolves.toMatchObject({
      data: [{ id: 'note-1' }],
    });
  });

  it('keeps scopes and collections apart when one collection is invalidated', async () => {
    const pending: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      pending.push(resolve);
    }));
    vi.stubGlobal('fetch', fetchMock);

    const otherScope = { userId: 'user-2', allowed: true, viewAsKey: 'view:role-2:team-2' };
    const notes = fetchTrainingCollection<{ count: number }>(allowedScope, 'summary');
    const records = fetchTrainingCollection<Array<{ id: string }>>(allowedScope, 'records');
    const otherNotes = fetchTrainingCollection<{ count: number }>(otherScope, 'summary');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    invalidateTrainingCollections(['summary']);
    const refreshedNotes = fetchTrainingCollection<{ count: number }>(allowedScope, 'summary');
    expect(fetchMock).toHaveBeenCalledTimes(4);

    pending[0]?.(jsonResponse(summaryBody));
    pending[1]?.(jsonResponse({
      records: [{ id: 'record-1' }],
      pagination: { has_more: false },
    }));
    pending[2]?.(jsonResponse({
      summary: { ...summaryBody.summary, activeRecords: 8 },
    }));
    pending[3]?.(jsonResponse({
      summary: { ...summaryBody.summary, activeRecords: 5 },
    }));

    const notesRead = await notes;
    const recordsRead = await records;
    const otherRead = await otherNotes;
    const refreshedRead = await refreshedNotes;

    expect(notesRead.data).toMatchObject({ activeRecords: 3 });
    expect(recordsRead.data).toEqual([{ id: 'record-1' }]);
    expect(otherRead.data).toMatchObject({ activeRecords: 8 });
    expect(refreshedRead.data).toMatchObject({ activeRecords: 5 });
    expect(isCurrentTrainingRead(notesRead, trainingCollectionEpoch('summary'), trainingScopeKey(allowedScope))).toBe(false);
    expect(isCurrentTrainingRead(recordsRead, trainingCollectionEpoch('records'), trainingScopeKey(allowedScope))).toBe(true);
    expect(isCurrentTrainingRead(refreshedRead, trainingCollectionEpoch('summary'), trainingScopeKey(allowedScope))).toBe(true);
    expect(isCurrentTrainingRead(otherRead, trainingCollectionEpoch('summary'), trainingScopeKey(allowedScope))).toBe(false);
    expect(isCurrentTrainingRead(otherRead, otherRead.epoch, trainingScopeKey(otherScope))).toBe(true);

    clearTrainingLoads();
    expect(isCurrentTrainingRead(recordsRead, trainingCollectionEpoch('records'), trainingScopeKey(allowedScope))).toBe(false);
  });

  it('refreshes visible dependents and leaves hidden dependents until the next access', () => {
    expect(splitTrainingRefresh('record', 'records')).toEqual({
      refresh: ['summary', 'records'],
      stale: ['people', 'qualifications'],
    });
    expect(splitTrainingRefresh('person', 'people')).toEqual({
      refresh: ['summary', 'people'],
      stale: ['records'],
    });
    expect(splitTrainingRefresh('qualification', 'notes')).toEqual({
      refresh: ['summary'],
      stale: ['qualifications', 'records'],
    });
  });
});
