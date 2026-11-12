// Synthetic repair fixture; used only by controlled tests and the live acceptance verifier.
// Re-armed for the owner's manual E2E test: controlled tests require both ends trimmed.
export function syntheticDisplayLabel(value: string): string {
  return value.trimEnd();
}
