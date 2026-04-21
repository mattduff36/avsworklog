function parseBooleanFlag(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isAccountSwitcherEnabled(): boolean {
  return parseBooleanFlag(process.env.NEXT_PUBLIC_ACCOUNT_SWITCHER_ENABLED);
}

export function isAccountSwitcherEnabledServer(): boolean {
  return parseBooleanFlag(
    process.env.ACCOUNT_SWITCHER_ENABLED ?? process.env.NEXT_PUBLIC_ACCOUNT_SWITCHER_ENABLED
  );
}
