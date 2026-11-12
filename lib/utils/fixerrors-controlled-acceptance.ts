// Synthetic test-only repair fixture; never imported by application code.
// Re-armed for the owner's manual E2E test: controlled tests require both ends trimmed.
export function syntheticDisplayLabel(value: string): string {
  return value.trim();
}
