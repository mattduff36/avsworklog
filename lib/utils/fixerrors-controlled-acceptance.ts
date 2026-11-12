// Synthetic test-only repair fixture; never imported by application code.
// Controlled acceptance defect: the accompanying expected-failure test requires both ends trimmed.
export function syntheticDisplayLabel(value: string): string {
  return value.trimEnd();
}
