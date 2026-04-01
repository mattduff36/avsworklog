export const READING_DIGIT_GROWTH_CONFIG = {
  ROLLOVER_INCREASE_THRESHOLD: 25,
};

export interface ReadingDigitGrowthWarningInput {
  enteredReading: number | null | undefined;
  previousReading: number | null | undefined;
  unitName: string;
  rolloverIncreaseThreshold?: number;
}

export interface ReadingDigitGrowthWarningResult {
  requiresConfirmation: boolean;
  warning?: string;
}

function normalizeReading(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  const normalized = Math.trunc(value);
  if (normalized < 0) return null;
  return normalized;
}

function getDigitCount(value: number): number {
  return Math.abs(value).toString().length;
}

function shouldIgnoreSmallRollover(
  previousReading: number,
  enteredReading: number,
  rolloverIncreaseThreshold: number
): boolean {
  const increase = enteredReading - previousReading;
  return increase >= 0 && increase <= rolloverIncreaseThreshold;
}

export function getReadingDigitGrowthWarning({
  enteredReading,
  previousReading,
  unitName,
  rolloverIncreaseThreshold = READING_DIGIT_GROWTH_CONFIG.ROLLOVER_INCREASE_THRESHOLD,
}: ReadingDigitGrowthWarningInput): ReadingDigitGrowthWarningResult {
  const normalizedEnteredReading = normalizeReading(enteredReading);
  const normalizedPreviousReading = normalizeReading(previousReading);
  if (normalizedEnteredReading === null || normalizedPreviousReading === null) {
    return { requiresConfirmation: false };
  }

  const enteredDigits = getDigitCount(normalizedEnteredReading);
  const previousDigits = getDigitCount(normalizedPreviousReading);

  if (enteredDigits <= previousDigits) {
    return { requiresConfirmation: false };
  }

  if (shouldIgnoreSmallRollover(normalizedPreviousReading, normalizedEnteredReading, rolloverIncreaseThreshold)) {
    return { requiresConfirmation: false };
  }

  return {
    requiresConfirmation: true,
    warning: `The entered value (${normalizedEnteredReading.toLocaleString()}) has more digits than the last recorded value (${normalizedPreviousReading.toLocaleString()}). Please enter only the FULL ${unitName} and ignore the fractional part (for example, if the meter shows 123.4, enter 123).`,
  };
}
