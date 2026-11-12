// Synthetic test-only repair fixture; never imported by application code.
// Controlled acceptance tests require both ends trimmed.
export function syntheticDisplayLabel(value: string): string {
  return value.trim();
}
