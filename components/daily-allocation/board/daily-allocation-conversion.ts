import {
  isDailyAllocationTrustedInterval,
  toDailyAllocationLondonDateTimeIso,
} from '@/lib/utils/daily-allocation-timeline';
import type {
  DailyAllocationConversionSource,
  DailyAllocationConvertInput,
} from '@/types/daily-allocation';
import type { JobCatalogueSourceType } from '@/types/job-catalogue';

export type DailyAllocationLabourDisposition = 'visit' | 'unallocated' | 'absence';
export type DailyAllocationPlantDisposition = 'visit' | 'unallocated';

export interface DailyAllocationConversionVisitDraft {
  id: string;
  key: string;
  jobSourceType: JobCatalogueSourceType;
  jobSourceId: string;
  jobCode: string;
  siteAddress: string;
  startTime: string;
  endTime: string;
  meetingPoint: string;
  meetPerson: string;
  notes: string;
}

export interface DailyAllocationConversionReview {
  visits: DailyAllocationConversionVisitDraft[];
  labour: Record<string, { disposition: DailyAllocationLabourDisposition | ''; visitKey: string | null }>;
  plant: Record<string, { disposition: DailyAllocationPlantDisposition | ''; visitKey: string | null }>;
}

function jobKey(sourceType: string, sourceId: string): string {
  return `${sourceType}:${sourceId}`;
}

export function createDailyAllocationConversionReview(
  source: DailyAllocationConversionSource,
  createId: () => string
): DailyAllocationConversionReview {
  const visitsByKey = new Map<string, DailyAllocationConversionVisitDraft>();
  const addVisit = (draft: {
    job_source_type: JobCatalogueSourceType | null;
    job_source_id: string | null;
    job_code: string | null;
    site_address: string | null;
    meeting_point?: string | null;
    meet_person?: string | null;
    notes?: string | null;
  }) => {
    if (!draft.job_source_type || !draft.job_source_id || !draft.job_code) return null;
    const key = jobKey(draft.job_source_type, draft.job_source_id);
    if (!visitsByKey.has(key)) {
      visitsByKey.set(key, {
        id: createId(),
        key,
        jobSourceType: draft.job_source_type,
        jobSourceId: draft.job_source_id,
        jobCode: draft.job_code,
        siteAddress: draft.site_address || '',
        startTime: '',
        endTime: '',
        meetingPoint: draft.meeting_point || '',
        meetPerson: draft.meet_person || '',
        notes: draft.notes || '',
      });
    }
    return key;
  };

  const labour: DailyAllocationConversionReview['labour'] = {};
  for (const draft of source.labour_drafts) {
    addVisit(draft);
    labour[draft.id] = {
      disposition: '',
      visitKey: null,
    };
  }
  const plant: DailyAllocationConversionReview['plant'] = {};
  for (const draft of source.plant_drafts) {
    addVisit(draft);
    plant[draft.id] = {
      disposition: '',
      visitKey: null,
    };
  }

  return { visits: [...visitsByKey.values()], labour, plant };
}

export function buildDailyAllocationConversionRequest(input: {
  source: DailyAllocationConversionSource;
  review: DailyAllocationConversionReview;
}): Omit<DailyAllocationConvertInput, 'request_id'> {
  const { source, review } = input;
  const visitsByKey = new Map(review.visits.map((visit) => [visit.key, visit]));
  const usedVisitKeys = new Set<string>();

  const labour_drafts = source.labour_drafts.map((draft) => {
    const mapping = review.labour[draft.id];
    if (!mapping?.disposition) {
      throw new Error(`Choose a disposition for labour draft ${draft.id}.`);
    }
    if (mapping.disposition === 'visit') {
      if (!mapping.visitKey || !visitsByKey.has(mapping.visitKey)) {
        throw new Error(`Choose a timed visit for labour draft ${draft.id}.`);
      }
      usedVisitKeys.add(mapping.visitKey);
    }
    return {
      draft_id: draft.id,
      row_version: draft.row_version,
      disposition: mapping.disposition,
      visit_id: mapping.disposition === 'visit'
        ? visitsByKey.get(mapping.visitKey!)!.id
        : null,
    };
  });

  const plant_drafts = source.plant_drafts.map((draft) => {
    const mapping = review.plant[draft.id];
    if (!mapping?.disposition) {
      throw new Error(`Choose a disposition for plant draft ${draft.id}.`);
    }
    if (mapping.disposition === 'visit') {
      if (!mapping.visitKey || !visitsByKey.has(mapping.visitKey)) {
        throw new Error(`Choose a timed visit for plant draft ${draft.id}.`);
      }
      usedVisitKeys.add(mapping.visitKey);
    }
    return {
      draft_id: draft.id,
      row_version: draft.row_version,
      disposition: mapping.disposition,
      visit_id: mapping.disposition === 'visit'
        ? visitsByKey.get(mapping.visitKey!)!.id
        : null,
    };
  });

  const visits = review.visits
    .filter((visit) => usedVisitKeys.has(visit.key))
    .map((visit) => {
      if (!/^\d{2}:\d{2}$/.test(visit.startTime) || !/^\d{2}:\d{2}$/.test(visit.endTime)) {
        throw new Error(`Choose valid times for ${visit.jobCode}.`);
      }
      const starts_at = toDailyAllocationLondonDateTimeIso(source.work_date, visit.startTime);
      const ends_at = toDailyAllocationLondonDateTimeIso(source.work_date, visit.endTime);
      if (!isDailyAllocationTrustedInterval(starts_at, ends_at)) {
        throw new Error(`Use 30-minute times with an end after the start for ${visit.jobCode}.`);
      }
      return {
        visit_id: visit.id,
        job_source_type: visit.jobSourceType,
        job_source_id: visit.jobSourceId,
        starts_at,
        ends_at,
        meeting_point: visit.meetingPoint.trim() || null,
        meet_person: visit.meetPerson.trim() || null,
        notes: visit.notes.trim() || null,
      };
    });

  return {
    work_date: source.work_date,
    team_id: source.team_id,
    expected_source_fingerprint: source.source_fingerprint,
    visits,
    labour_drafts,
    plant_drafts,
  };
}
