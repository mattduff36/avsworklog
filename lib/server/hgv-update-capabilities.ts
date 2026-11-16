/** Server-only rollout switch. Production remains compatible/read-only for new actions. */
export function hgvDailyCheckUpdatesEnabled(): boolean {
  return process.env.HGV_DAILY_CHECK_UPDATES_ENABLED === 'true';
}
