import { describe, expect, it } from 'vitest';
import {
  getDisplayedTeamName,
  SYSTEM_ACCOUNTS_TEAM_ID,
  SYSTEM_TEAM_DISPLAY_NAME,
} from '@/lib/utils/system-accounts';

describe('system team display name', () => {
  it('shows System for the system team and leaves other names unchanged', () => {
    expect(getDisplayedTeamName({ id: SYSTEM_ACCOUNTS_TEAM_ID, name: 'System Accounts' })).toBe(
      SYSTEM_TEAM_DISPLAY_NAME
    );
    expect(getDisplayedTeamName({ id: 'workshop', is_system: true, name: 'Workshop' })).toBe(
      SYSTEM_TEAM_DISPLAY_NAME
    );
    expect(getDisplayedTeamName({ id: 'plant', is_system: false, name: 'Plant' })).toBe('Plant');
  });
});
