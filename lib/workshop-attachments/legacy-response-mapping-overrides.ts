export interface LegacyResponseOverrideQuestion {
  id?: string;
  question_text: string;
  question_type: string;
  sort_order: number;
}

export interface LegacyResponseOverrideTarget {
  section_key: string;
  field_key: string;
  is_comment_target?: boolean;
}

export interface LegacyResponseTemplateOverrides {
  template_ids?: string[];
  template_name_includes?: string[];
  question_id_targets?: Record<string, LegacyResponseOverrideTarget>;
  question_text_targets?: Array<{
    contains: string;
    target: LegacyResponseOverrideTarget;
  }>;
}

const TEMPLATE_OVERRIDES: LegacyResponseTemplateOverrides[] = [];

function normalizeValue(value: string): string {
  return value.trim().toLowerCase();
}

function templateMatches(
  override: LegacyResponseTemplateOverrides,
  templateId: string,
  templateName: string,
): boolean {
  const templateNameNormalized = normalizeValue(templateName);
  const idMatch = override.template_ids?.includes(templateId) || false;
  const nameMatch = (override.template_name_includes || []).some((entry) =>
    templateNameNormalized.includes(normalizeValue(entry)),
  );
  return idMatch || nameMatch;
}

export function resolveLegacyResponseOverride(
  templateId: string,
  templateName: string,
  question: LegacyResponseOverrideQuestion,
): LegacyResponseOverrideTarget | null {
  for (const override of TEMPLATE_OVERRIDES) {
    if (!templateMatches(override, templateId, templateName)) continue;

    if (question.id && override.question_id_targets?.[question.id]) {
      return override.question_id_targets[question.id];
    }

    const normalizedQuestionText = normalizeValue(question.question_text);
    for (const textTarget of override.question_text_targets || []) {
      if (normalizedQuestionText.includes(normalizeValue(textTarget.contains))) {
        return textTarget.target;
      }
    }
  }

  return null;
}
