function normalizeFlag(value: string | undefined): boolean {
  if (!value) return false;
  const nextValue = value.trim().toLowerCase();
  return nextValue === '1' || nextValue === 'true' || nextValue === 'yes' || nextValue === 'on';
}

export function isAccountSwitcherEnabled(): boolean {
  return normalizeFlag(process.env.NEXT_PUBLIC_ACCOUNT_SWITCHER_ENABLED);
}

export function isAccountSwitcherEnabledServer(): boolean {
  if (normalizeFlag(process.env.ACCOUNT_SWITCHER_ENABLED)) {
    return true;
  }

  return isAccountSwitcherEnabled();
}
