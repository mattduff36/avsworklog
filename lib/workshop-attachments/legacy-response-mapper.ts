import {
  resolveLegacyResponseOverride,
  type LegacyResponseOverrideQuestion,
} from './legacy-response-mapping-overrides';

export interface LegacyQuestionForMapping {
  id: string;
  question_text: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
}

export interface LegacyResponseForMapping {
  question_id: string;
  response_value: string | null;
}

export interface SnapshotFieldForMapping {
  id?: string;
  field_key: string;
  label: string;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature' | string;
  sort_order: number;
}

export interface SnapshotSectionForMapping {
  section_key: string;
  title: string;
  sort_order: number;
  fields: SnapshotFieldForMapping[];
}

export interface AttachmentSnapshotForMapping {
  sections: SnapshotSectionForMapping[];
}

export interface MappedFieldResponseDraft {
  section_key: string;
  field_key: string;
  field_id: string | null;
  response_value: string | null;
  response_json: Record<string, unknown> | null;
}

export interface LegacyMappingBlocker {
  attachment_id: string;
  template_id: string;
  template_name: string;
  question_id: string;
  question_text: string;
  question_type: string;
  response_value: string | null;
  reason: string;
}

export interface LegacyMappingWarning {
  attachment_id: string;
  template_id: string;
  template_name: string;
  question_id: string;
  question_text: string;
  message: string;
}

export interface MapLegacyResponsesInput {
  attachment_id: string;
  template_id: string;
  template_name: string;
  snapshot: AttachmentSnapshotForMapping;
  questions: LegacyQuestionForMapping[];
  responses: LegacyResponseForMapping[];
}

export interface MapLegacyResponsesResult {
  mapped_responses: MappedFieldResponseDraft[];
  blockers: LegacyMappingBlocker[];
  warnings: LegacyMappingWarning[];
}

interface SnapshotFieldResolved extends SnapshotFieldForMapping {
  section_key: string;
  section_sort_order: number;
}

interface QuestionMappingTarget {
  section_key: string;
  field_key: string;
  field_id: string | null;
  field_type: string;
  is_comment_target: boolean;
}

const COMMENT_HINTS = new Set([
  'comment',
  'comments',
  'any comments',
  'notes',
  'note',
  'details',
  'defect details',
  'rectification details',
]);

const MARKING_CODE_VALUES = new Set([
  'serviceable',
  'attention',
  'not_checked',
  'not_applicable',
  'monitor',
]);

function normalizeValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function normalizeKey(value: string): string {
  return normalizeValue(value).toLowerCase().replace(/\s+/g, ' ');
}

function normalizeSlug(value: string): string {
  return normalizeValue(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isCommentLikeQuestion(questionText: string): boolean {
  const normalized = normalizeKey(questionText);
  if (COMMENT_HINTS.has(normalized)) return true;
  if (normalized.startsWith('comment ')) return true;
  if (normalized.startsWith('comments ')) return true;
  if (normalized.startsWith('any comments')) return true;
  return false;
}

function flattenSnapshotFields(snapshot: AttachmentSnapshotForMapping): SnapshotFieldResolved[] {
  const sections = (snapshot.sections || [])
    .slice()
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));

  const output: SnapshotFieldResolved[] = [];
  for (const section of sections) {
    const fields = (section.fields || [])
      .slice()
      .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));
    for (const field of fields) {
      output.push({
        ...field,
        section_key: section.section_key,
        section_sort_order: Number(section.sort_order || 0),
      });
    }
  }

  return output;
}

function findSectionCommentField(
  sectionKey: string,
  fields: SnapshotFieldResolved[],
): SnapshotFieldResolved | null {
  const inSection = fields.filter((field) => field.section_key === sectionKey);
  if (inSection.length === 0) return null;

  const byKey = inSection.find((field) => normalizeSlug(field.field_key).startsWith('section_comments'));
  if (byKey) return byKey;

  const byLabel = inSection.find((field) => normalizeKey(field.label) === 'section comments');
  if (byLabel) return byLabel;

  return null;
}

function pickFieldByQuestionLabel(
  question: LegacyQuestionForMapping,
  fields: SnapshotFieldResolved[],
  usedFieldKeys: Set<string>,
): SnapshotFieldResolved | null {
  const normalizedLabel = normalizeKey(question.question_text);
  const normalizedSlug = normalizeSlug(question.question_text);
  const exactLabel = fields.filter((field) => normalizeKey(field.label) === normalizedLabel);
  const slugMatches = fields.filter((field) => normalizeSlug(field.field_key) === normalizedSlug);
  const candidates = exactLabel.length > 0 ? exactLabel : slugMatches;
  if (candidates.length === 0) return null;

  const unusedCandidate = candidates.find(
    (candidate) => !usedFieldKeys.has(`${candidate.section_key}::${candidate.field_key}`),
  );
  return unusedCandidate || candidates[0];
}

function coerceResponseForField(
  fieldType: string,
  rawValue: string,
): { value: string | null; error: string | null } {
  const normalizedRaw = normalizeValue(rawValue);
  if (!normalizedRaw) return { value: null, error: null };

  if (fieldType === 'marking_code') {
    const candidate = normalizedRaw.toLowerCase();
    if (MARKING_CODE_VALUES.has(candidate)) return { value: candidate, error: null };
    if (['true', 'yes', 'y', '1'].includes(candidate)) return { value: 'serviceable', error: null };
    if (['false', 'no', 'n', '0'].includes(candidate)) return { value: 'attention', error: null };
    return {
      value: null,
      error: `Unable to coerce value "${normalizedRaw}" into marking code`,
    };
  }

  if (fieldType === 'yes_no') {
    const candidate = normalizedRaw.toLowerCase();
    if (['yes', 'no', 'na'].includes(candidate)) return { value: candidate, error: null };
    if (['true', 'y', '1'].includes(candidate)) return { value: 'yes', error: null };
    if (['false', 'n', '0'].includes(candidate)) return { value: 'no', error: null };
    return {
      value: null,
      error: `Unable to coerce value "${normalizedRaw}" into yes/no`,
    };
  }

  if (fieldType === 'signature') {
    return {
      value: null,
      error: 'Legacy responses cannot be coerced into signature fields',
    };
  }

  return { value: normalizedRaw, error: null };
}

export function mapLegacyResponsesToV2(input: MapLegacyResponsesInput): MapLegacyResponsesResult {
  const fields = flattenSnapshotFields(input.snapshot);
  const questions = input.questions
    .slice()
    .sort((left, right) => Number(left.sort_order || 0) - Number(right.sort_order || 0));

  const blockers: LegacyMappingBlocker[] = [];
  const warnings: LegacyMappingWarning[] = [];
  const questionMap = new Map<string, QuestionMappingTarget>();
  const usedFieldKeys = new Set<string>();

  let previousNonCommentSectionKey: string | null = null;

  for (const question of questions) {
    const override = resolveLegacyResponseOverride(
      input.template_id,
      input.template_name,
      question as LegacyResponseOverrideQuestion,
    );

    if (override) {
      const targetField = fields.find(
        (field) =>
          field.section_key === override.section_key &&
          normalizeSlug(field.field_key) === normalizeSlug(override.field_key),
      );

      if (!targetField) {
        blockers.push({
          attachment_id: input.attachment_id,
          template_id: input.template_id,
          template_name: input.template_name,
          question_id: question.id,
          question_text: question.question_text,
          question_type: question.question_type,
          response_value: null,
          reason: `Manual override target missing: ${override.section_key}::${override.field_key}`,
        });
        continue;
      }

      questionMap.set(question.id, {
        section_key: targetField.section_key,
        field_key: targetField.field_key,
        field_id: targetField.id || null,
        field_type: targetField.field_type,
        is_comment_target: Boolean(override.is_comment_target),
      });
      if (!override.is_comment_target) previousNonCommentSectionKey = targetField.section_key;
      continue;
    }

    if (isCommentLikeQuestion(question.question_text)) {
      if (!previousNonCommentSectionKey) continue;
      const commentsField = findSectionCommentField(previousNonCommentSectionKey, fields);
      if (!commentsField) continue;
      questionMap.set(question.id, {
        section_key: commentsField.section_key,
        field_key: commentsField.field_key,
        field_id: commentsField.id || null,
        field_type: commentsField.field_type,
        is_comment_target: true,
      });
      continue;
    }

    const matchedField = pickFieldByQuestionLabel(question, fields, usedFieldKeys);
    if (!matchedField) continue;

    const targetKey = `${matchedField.section_key}::${matchedField.field_key}`;
    usedFieldKeys.add(targetKey);
    questionMap.set(question.id, {
      section_key: matchedField.section_key,
      field_key: matchedField.field_key,
      field_id: matchedField.id || null,
      field_type: matchedField.field_type,
      is_comment_target: false,
    });
    previousNonCommentSectionKey = matchedField.section_key;
  }

  const questionsById = new Map(questions.map((question) => [question.id, question]));
  const merged = new Map<string, MappedFieldResponseDraft>();
  const responses = input.responses.filter((response) => normalizeValue(response.response_value).length > 0);

  for (const response of responses) {
    const question = questionsById.get(response.question_id);
    if (!question) {
      blockers.push({
        attachment_id: input.attachment_id,
        template_id: input.template_id,
        template_name: input.template_name,
        question_id: response.question_id,
        question_text: 'Unknown question',
        question_type: 'unknown',
        response_value: response.response_value,
        reason: 'Legacy response references question that no longer exists',
      });
      continue;
    }

    const mapping = questionMap.get(question.id);
    if (!mapping) {
      blockers.push({
        attachment_id: input.attachment_id,
        template_id: input.template_id,
        template_name: input.template_name,
        question_id: question.id,
        question_text: question.question_text,
        question_type: question.question_type,
        response_value: response.response_value,
        reason: 'No V2 field mapping found for legacy question',
      });
      continue;
    }

    const coerced = coerceResponseForField(mapping.field_type, normalizeValue(response.response_value));
    if (coerced.error) {
      blockers.push({
        attachment_id: input.attachment_id,
        template_id: input.template_id,
        template_name: input.template_name,
        question_id: question.id,
        question_text: question.question_text,
        question_type: question.question_type,
        response_value: response.response_value,
        reason: coerced.error,
      });
      continue;
    }

    const mapKey = `${mapping.section_key}::${mapping.field_key}`;
    const existing = merged.get(mapKey);

    if (mapping.is_comment_target) {
      const commentValue = normalizeValue(coerced.value);
      if (!commentValue) continue;
      const prefix = normalizeKey(question.question_text) === 'comments'
        || normalizeKey(question.question_text) === 'comment'
        || normalizeKey(question.question_text) === 'notes'
        || normalizeKey(question.question_text) === 'note'
        ? ''
        : `${question.question_text}: `;
      const nextValue = `${prefix}${commentValue}`;

      if (!existing) {
        merged.set(mapKey, {
          section_key: mapping.section_key,
          field_key: mapping.field_key,
          field_id: mapping.field_id,
          response_value: nextValue,
          response_json: null,
        });
      } else {
        const current = normalizeValue(existing.response_value);
        existing.response_value = current ? `${current}\n${nextValue}` : nextValue;
      }
      continue;
    }

    if (!existing) {
      merged.set(mapKey, {
        section_key: mapping.section_key,
        field_key: mapping.field_key,
        field_id: mapping.field_id,
        response_value: coerced.value,
        response_json: null,
      });
      continue;
    }

    const existingValue = normalizeValue(existing.response_value);
    const nextValue = normalizeValue(coerced.value);
    if (existingValue !== nextValue) {
      warnings.push({
        attachment_id: input.attachment_id,
        template_id: input.template_id,
        template_name: input.template_name,
        question_id: question.id,
        question_text: question.question_text,
        message: `Multiple legacy responses mapped to ${mapKey}. Keeping latest value.`,
      });
      existing.response_value = coerced.value;
    }
  }

  return {
    mapped_responses: Array.from(merged.values()),
    blockers,
    warnings,
  };
}
