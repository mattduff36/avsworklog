import { fetchAllPaginatedItems } from '@/lib/client/paginated-fetch';
import { createStatusError } from '@/lib/utils/http-error';
import type { TrainingSummary } from '@/types/training';

export const TRAINING_SUMMARY_PATH = '/api/training/summary';
export const TRAINING_PAGE_LIMIT = 500;

export const TRAINING_COLLECTIONS = ['summary', 'records', 'people', 'qualifications', 'notes'] as const;
export type TrainingCollection = (typeof TRAINING_COLLECTIONS)[number];
export type TrainingListCollection = Exclude<TrainingCollection, 'summary'>;
export type TrainingTab = 'overview' | 'records' | 'people' | 'qualifications' | 'notes';
export type TrainingMutation = 'record' | 'person' | 'qualification';

export interface TrainingLoadScope {
  userId: string;
  allowed: boolean;
  viewAsKey: string;
}

export interface TrainingCollectionRead<TData> {
  epoch: number;
  scopeKey: string;
  collection: TrainingCollection;
  data: TData;
}

interface TrainingListSpec {
  path: string;
  itemsKey: string;
  errorMessage: string;
}

export const TRAINING_LISTS: Record<TrainingListCollection, TrainingListSpec> = {
  records: {
    path: '/api/training/records',
    itemsKey: 'records',
    errorMessage: 'Failed to fetch training records',
  },
  people: {
    path: '/api/training/people',
    itemsKey: 'people',
    errorMessage: 'Failed to fetch training people',
  },
  qualifications: {
    path: '/api/training/qualifications',
    itemsKey: 'qualifications',
    errorMessage: 'Failed to fetch training qualifications',
  },
  notes: {
    path: '/api/training/notes',
    itemsKey: 'notes',
    errorMessage: 'Failed to fetch training notes',
  },
};

export const TRAINING_TAB_COLLECTIONS: Record<TrainingTab, readonly TrainingCollection[]> = {
  overview: ['summary', 'records'],
  records: ['summary', 'records'],
  people: ['summary', 'people'],
  qualifications: ['summary', 'qualifications'],
  notes: ['summary', 'notes'],
};

const TRAINING_MUTATION_DEPENDENTS: Record<TrainingMutation, readonly TrainingCollection[]> = {
  record: ['summary', 'records', 'people', 'qualifications'],
  person: ['summary', 'people', 'records'],
  qualification: ['summary', 'qualifications', 'records'],
};

const SUMMARY_FIELDS = [
  'totalRecords',
  'activeRecords',
  'archivedRecords',
  'expiredRecords',
  'expiringSoonRecords',
  'noExpiryRecords',
  'needsNvqRecords',
  'awaitingCardRecords',
  'trainingBookedRecords',
  'manualReviewRecords',
  'unlinkedPeople',
] as const satisfies readonly (keyof TrainingSummary)[];

const epochs: Record<TrainingCollection, number> = {
  summary: 0,
  records: 0,
  people: 0,
  qualifications: 0,
  notes: 0,
};
const inflight = new Map<string, Promise<TrainingCollectionRead<unknown>>>();

export function trainingScopeKey(scope: TrainingLoadScope): string {
  return `${scope.allowed ? 'allowed' : 'denied'}\n${scope.userId}\n${scope.viewAsKey}`;
}

export function trainingCollectionEpoch(collection: TrainingCollection): number {
  return epochs[collection];
}

export function invalidateTrainingCollections(collections: readonly TrainingCollection[]): void {
  const selected = new Set(collections);
  for (const collection of selected) epochs[collection] += 1;
  for (const key of inflight.keys()) {
    const collection = key.slice(0, key.indexOf('\n')) as TrainingCollection;
    if (selected.has(collection)) inflight.delete(key);
  }
}

export function clearTrainingLoads(): void {
  invalidateTrainingCollections(TRAINING_COLLECTIONS);
}

export function resetTrainingLoaderState(): void {
  for (const collection of TRAINING_COLLECTIONS) epochs[collection] = 0;
  inflight.clear();
}

export function isCurrentTrainingRead(
  read: Pick<TrainingCollectionRead<unknown>, 'epoch' | 'scopeKey'>,
  currentEpoch: number,
  currentScopeKey: string | null,
): boolean {
  return currentScopeKey !== null && read.epoch === currentEpoch && read.scopeKey === currentScopeKey;
}

export function parseTrainingTab(value: string | null | undefined): TrainingTab {
  if (value === 'records' || value === 'people' || value === 'qualifications' || value === 'notes') return value;
  return 'overview';
}

export function splitTrainingRefresh(
  mutation: TrainingMutation,
  activeTab: TrainingTab,
): { refresh: TrainingCollection[]; stale: TrainingCollection[] } {
  const visible = new Set<TrainingCollection>(TRAINING_TAB_COLLECTIONS[activeTab]);
  const refresh: TrainingCollection[] = [];
  const stale: TrainingCollection[] = [];
  for (const collection of TRAINING_MUTATION_DEPENDENTS[mutation]) {
    if (visible.has(collection)) refresh.push(collection);
    else stale.push(collection);
  }
  return { refresh, stale };
}

function inflightKey(collection: TrainingCollection, scopeKey: string): string {
  return `${collection}\n${scopeKey}`;
}

function assertTrainingScope(scope: TrainingLoadScope): void {
  if (!scope.allowed || scope.userId.trim().length === 0) {
    throw createStatusError('Training access required', 403);
  }
}

function isTrainingSummary(value: unknown): value is TrainingSummary {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return SUMMARY_FIELDS.every((field) => typeof record[field] === 'number' && Number.isFinite(record[field]));
}

async function readTrainingSummary(): Promise<TrainingSummary> {
  const response = await fetch(TRAINING_SUMMARY_PATH, { cache: 'no-store' });
  const payload = (await response.json().catch(() => ({}))) as { error?: string; summary?: unknown };
  if (!response.ok) {
    throw createStatusError(payload.error || 'Failed to fetch training summary', response.status, payload);
  }
  if (!isTrainingSummary(payload.summary)) throw new Error('Training summary was not returned');
  return payload.summary;
}

async function readTrainingList(collection: TrainingListCollection): Promise<unknown[]> {
  const spec = TRAINING_LISTS[collection];
  const { items } = await fetchAllPaginatedItems<unknown>(spec.path, spec.itemsKey, {
    limit: TRAINING_PAGE_LIMIT,
    errorMessage: spec.errorMessage,
  });
  return items;
}

export async function fetchTrainingCollection<TData>(
  scope: TrainingLoadScope,
  collection: TrainingCollection,
): Promise<TrainingCollectionRead<TData>> {
  assertTrainingScope(scope);
  const scopeKey = trainingScopeKey(scope);
  const key = inflightKey(collection, scopeKey);
  const existing = inflight.get(key) as Promise<TrainingCollectionRead<TData>> | undefined;
  if (existing) return existing;

  const epoch = epochs[collection];
  const promise = (collection === 'summary' ? readTrainingSummary() : readTrainingList(collection))
    .then((data) => ({ epoch, scopeKey, collection, data: data as TData }));
  const stored = promise as Promise<TrainingCollectionRead<unknown>>;
  const clearStored = () => {
    if (inflight.get(key) === stored) inflight.delete(key);
  };
  void stored.then(clearStored, clearStored);
  inflight.set(key, stored);
  return promise;
}
