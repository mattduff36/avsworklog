// Synthetic repair fixture; used only by controlled tests and the live acceptance verifier.
// Controlled tests and live acceptance require both ends trimmed.
export function syntheticDisplayLabel(value: string): string {
  return value.trim();
}
