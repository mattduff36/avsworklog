// Synthetic test-only repair fixture; never imported by application code.
// Re-armed controlled acceptance defect; expected-failure tests require both ends trimmed.
export function syntheticDisplayLabel(value: string): string {
  return value.trimEnd();
}
