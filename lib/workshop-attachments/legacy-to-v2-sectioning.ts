import {
  type LegacyTemplateSectionRule,
  getLegacyTemplateSectionRules,
} from './legacy-to-v2-overrides';

export interface LegacyQuestionInput {
  id?: string;
  question_text: string;
  question_type: string;
  is_required?: boolean;
  sort_order?: number;
}

export interface LegacyToV2FieldDraft {
  field_key: string;
  label: string;
  help_text: string | null;
  field_type: 'marking_code' | 'text' | 'long_text' | 'number' | 'date' | 'yes_no' | 'signature';
  is_required: boolean;
  sort_order: number;
  options_json: Record<string, unknown> | null;
  validation_json: Record<string, unknown> | null;
}

export interface LegacyToV2SectionDraft {
  section_key: string;
  title: string;
  description: string;
  sort_order: number;
  fields: LegacyToV2FieldDraft[];
}

interface SectionBucket {
  section_rule: LegacyTemplateSectionRule;
  fields: LegacyToV2FieldDraft[];
  first_sort_order: number;
  has_comment_prompt: boolean;
}

const MARKING_CODE_OPTIONS = [
  { value: 'serviceable', label: 'Pass' },
  { value: 'attention', label: 'Requires Attention' },
  { value: 'not_applicable', label: 'Not Applicable' },
];

const COMMENT_HINTS = [
  'comment',
  'comments',
  'any comments',
  'notes',
  'note',
  'details',
  'defect details',
  'rectification details',
];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function toKey(value: string, fallback: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 110);
  if (!normalized) return fallback;
  return normalized;
}

function normalizeQuestionType(questionType: string): string {
  return questionType.trim().toLowerCase();
}

function isCommentLikeQuestion(questionText: string): boolean {
  const normalized = normalizeWhitespace(questionText.toLowerCase());
  if (COMMENT_HINTS.includes(normalized)) return true;
  if (normalized.startsWith('comment ')) return true;
  if (normalized.startsWith('comments ')) return true;
  if (normalized.startsWith('any comments')) return true;
  return false;
}

function mapLegacyTypeToV2FieldType(questionType: string): LegacyToV2FieldDraft['field_type'] {
  const normalizedType = normalizeQuestionType(questionType);
  if (normalizedType === 'checkbox') return 'marking_code';
  if (normalizedType === 'long_text') return 'long_text';
  if (normalizedType === 'number') return 'number';
  if (normalizedType === 'date') return 'date';
  return 'text';
}

function scoreSectionMatch(questionText: string, section: LegacyTemplateSectionRule): number {
  const normalizedText = normalizeWhitespace(questionText.toLowerCase());
  return section.keyword_hints.reduce((score, keyword) => {
    if (!keyword.trim()) return score;
    return normalizedText.includes(keyword.toLowerCase()) ? score + 1 : score;
  }, 0);
}

function findBestSectionRule(
  questionText: string,
  sectionRules: LegacyTemplateSectionRule[],
): LegacyTemplateSectionRule | null {
  let winner: LegacyTemplateSectionRule | null = null;
  let bestScore = 0;

  for (const sectionRule of sectionRules) {
    const score = scoreSectionMatch(questionText, sectionRule);
    if (score > bestScore) {
      bestScore = score;
      winner = sectionRule;
    }
  }

  return bestScore > 0 ? winner : null;
}

function ensureBucket(
  buckets: Map<string, SectionBucket>,
  sectionRule: LegacyTemplateSectionRule,
  firstSortOrder: number,
): SectionBucket {
  const existing = buckets.get(sectionRule.section_key);
  if (existing) return existing;

  const created: SectionBucket = {
    section_rule: sectionRule,
    fields: [],
    first_sort_order: firstSortOrder,
    has_comment_prompt: false,
  };
  buckets.set(sectionRule.section_key, created);
  return created;
}

function withUniqueFieldKey(fieldKey: string, usedFieldKeys: Set<string>, fallbackSuffix: number): string {
  let candidate = fieldKey;
  let duplicateIndex = 1;
  while (usedFieldKeys.has(candidate)) {
    candidate = `${fieldKey}_${fallbackSuffix}_${duplicateIndex}`;
    duplicateIndex += 1;
  }
  usedFieldKeys.add(candidate);
  return candidate;
}

export function inferLegacySectionsForTemplate(
  templateName: string,
  legacyQuestions: LegacyQuestionInput[],
): LegacyToV2SectionDraft[] {
  const sectionRules = getLegacyTemplateSectionRules(templateName);
  const normalizedQuestions = legacyQuestions
    .map((question, index) => ({
      question_text: normalizeWhitespace(question.question_text || `Question ${index + 1}`),
      question_type: normalizeQuestionType(question.question_type || 'text'),
      is_required: Boolean(question.is_required),
      sort_order: Number(question.sort_order || index + 1),
      source_index: index,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  const fallbackRule: LegacyTemplateSectionRule = {
    section_key: 'general',
    title: 'General',
    description: 'Additional checks not mapped to a specialized section.',
    keyword_hints: [],
  };

  const buckets = new Map<string, SectionBucket>();
  const usedFieldKeysBySection = new Map<string, Set<string>>();
  let previousFieldContext:
    | { section_key: string; base_label: string }
    | null = null;

  for (const question of normalizedQuestions) {
    const bestRule = findBestSectionRule(question.question_text, sectionRules);
    let sectionRule = bestRule || fallbackRule;
    const commentLike = isCommentLikeQuestion(question.question_text);

    if (commentLike && previousFieldContext) {
      sectionRule = buckets.get(previousFieldContext.section_key)?.section_rule || sectionRule;
    }

    const bucket = ensureBucket(buckets, sectionRule, question.sort_order);
    if (commentLike) {
      bucket.has_comment_prompt = true;
      continue;
    }

    const usedFieldKeys = usedFieldKeysBySection.get(bucket.section_rule.section_key) || new Set<string>();

    const fieldLabel = question.question_text;

    const fieldType = mapLegacyTypeToV2FieldType(question.question_type);
    const baseFieldKey = toKey(fieldLabel, `field_${question.source_index + 1}`);
    const fieldKey = withUniqueFieldKey(baseFieldKey, usedFieldKeys, question.source_index + 1);
    usedFieldKeysBySection.set(bucket.section_rule.section_key, usedFieldKeys);

    const field: LegacyToV2FieldDraft = {
      field_key: fieldKey,
      label: fieldLabel,
      help_text: null,
      field_type: fieldType,
      is_required: question.is_required,
      sort_order: bucket.fields.length + 1,
      options_json: null,
      validation_json: null,
    };

    if (fieldType === 'marking_code') {
      field.options_json = { options: MARKING_CODE_OPTIONS };
      field.validation_json = { require_note_for: ['attention'] };
    }

    bucket.fields.push(field);
    previousFieldContext = {
      section_key: bucket.section_rule.section_key,
      base_label: fieldLabel,
    };
  }

  for (const bucket of buckets.values()) {
    if (!bucket.has_comment_prompt) continue;
    const usedFieldKeys = usedFieldKeysBySection.get(bucket.section_rule.section_key) || new Set<string>();
    const commentsKey = withUniqueFieldKey('section_comments', usedFieldKeys, bucket.fields.length + 1);
    usedFieldKeysBySection.set(bucket.section_rule.section_key, usedFieldKeys);

    bucket.fields.push({
      field_key: commentsKey,
      label: 'Section Comments',
      help_text: 'Capture notes once for this section.',
      field_type: 'long_text',
      is_required: false,
      sort_order: bucket.fields.length + 1,
      options_json: null,
      validation_json: null,
    });
  }

  const orderedRules = sectionRules.map((rule) => rule.section_key);
  const bucketsAsArray = Array.from(buckets.values());
  bucketsAsArray.sort((left, right) => {
    const leftIndex = orderedRules.indexOf(left.section_rule.section_key);
    const rightIndex = orderedRules.indexOf(right.section_rule.section_key);
    const leftRank = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex;
    const rightRank = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.first_sort_order - right.first_sort_order;
  });

  return bucketsAsArray
    .filter((bucket) => bucket.fields.length > 0)
    .map((bucket, index) => ({
      section_key: toKey(bucket.section_rule.section_key, `section_${index + 1}`),
      title: bucket.section_rule.title,
      description: bucket.section_rule.description,
      sort_order: index + 1,
      fields: bucket.fields,
    }));
}
