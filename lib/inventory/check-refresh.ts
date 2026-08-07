export const INVENTORY_CHECK_REFRESH_WARNING =
  'Inventory check was saved, but the list could not be refreshed. Reload if dates look stale.';

export const INVENTORY_CHECK_HISTORY_REFRESH_WARNING =
  'Inventory check was saved, but history could not be refreshed. Reload if dates look stale.';

export async function runInventoryCheckRefresh(
  refresh: (() => Promise<void> | void) | undefined,
  onRefreshFailure: (message: string) => void,
  warningMessage = INVENTORY_CHECK_REFRESH_WARNING,
): Promise<'skipped' | 'refreshed' | 'refresh_failed'> {
  if (!refresh) return 'skipped';

  try {
    await refresh();
    return 'refreshed';
  } catch {
    onRefreshFailure(warningMessage);
    return 'refresh_failed';
  }
}
